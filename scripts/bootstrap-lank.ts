// One-time bootstrap to populate the lank network without re-syncing metro
// ratings. Future weekly syncs will handle both networks via the regular
// `npm run sync` flow.
//
// Steps:
//   1. discover lycandb's follows into users_stg (is_lycan=true).
//   2. UPDATE live `users` to set is_lycan=true for the ~25 overlap users.
//   3. INSERT the lycan-only users (~14) into live `users`.
//   4. Pull ratings only for those NEW users (writing directly into live
//      `ratings` — bypasses ratings_stg so the metro data stays untouched).
//   5. syncNewFilms fetches details + posters for any new film stubs.
//   6. Insert the first lank rankings snapshot + lank similarity scores into
//      the live history tables at the current MAX(week).
//
// Idempotent: re-running just re-flags existing users, re-fetches missing
// new-user ratings, and replaces any existing lank rows for the current week.

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import pool from '../db/conn.js';
import { discoverMembers } from '../sync/discover-members.js';
import { syncNewFilms } from '../sync/sync-films.js';
import { apiRequest, paginate } from '../sync/lbx-client.js';
import type { PoolClient } from 'pg';

const POSTER_DIR = path.resolve('images/posters');

interface LetterboxdFilmListItem {
    id?: string;
    link?: string;
    name?: string;
    releaseYear?: number;
    relationships?: Array<{ relationship?: { rating?: number } }>;
}

interface MemberStatistics {
    counts?: { ratings?: number; watches?: number; diaryEntries?: number };
}

function slugFromLink(link?: string): string | null {
    if (!link) return null;
    const m = link.match(/\/film\/([^/]+)\/?/);
    return m ? m[1].toLowerCase() : null;
}

async function upsertFilmStub(client: PoolClient, lid: string, slug: string, title: string | undefined, year: number | null | undefined): Promise<number | null> {
    if (!lid || !slug) return null;
    const existing = await client.query<{ film_id: number; slug: string }>(
        `SELECT film_id, slug FROM films WHERE letterboxd_id = $1`, [lid],
    );
    if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0];
        if (row.slug !== slug) {
            // Slug changed on Letterboxd; rename our record + the poster file.
            try {
                await client.query(`UPDATE films SET slug = $1, time_modified = NOW() WHERE letterboxd_id = $2`, [slug, lid]);
                const oldP = path.join(POSTER_DIR, `${row.slug}.jpg`);
                const newP = path.join(POSTER_DIR, `${slug}.jpg`);
                if (fs.existsSync(oldP) && !fs.existsSync(newP)) fs.renameSync(oldP, newP);
            } catch (err) {
                if ((err as { code?: string }).code !== '23505') throw err;
                console.warn(`[bootstrap-lank] slug rename collision for ${lid}; keeping old slug`);
            }
        }
        return row.film_id;
    }
    try {
        const r = await client.query<{ film_id: number }>(
            `INSERT INTO films (letterboxd_id, slug, title, year, time_created, time_modified)
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING film_id`,
            [lid, slug, title || slug, year ?? null],
        );
        return r.rows[0].film_id;
    } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        const r = await client.query<{ film_id: number }>(
            `UPDATE films SET letterboxd_id = $1, time_modified = NOW()
              WHERE slug = $2 AND letterboxd_id IS NULL RETURNING film_id`,
            [lid, slug],
        );
        return (r.rowCount ?? 0) > 0 ? r.rows[0].film_id : null;
    }
}

async function pullRatingsLive(member: { user_id: number; letterboxd_id: string; username: string }, newFilmIds: Set<number>): Promise<number> {
    const client = await pool.connect();
    let ingested = 0;
    try {
        for await (const item of paginate<LetterboxdFilmListItem>('/films', { member: member.letterboxd_id, memberRelationship: 'Rated', perPage: '100' })) {
            const rating = item?.relationships?.[0]?.relationship?.rating;
            if (rating == null || !item.id) continue;
            const slug = slugFromLink(item.link);
            if (!slug) continue;

            const existing = await client.query<{ film_id: number; details_fetched_at: Date | null }>(
                `SELECT film_id, details_fetched_at FROM films WHERE letterboxd_id = $1`, [item.id],
            );
            const wasNew = (existing.rowCount ?? 0) === 0;
            const existingNeedsDetails = (existing.rowCount ?? 0) > 0 && existing.rows[0].details_fetched_at == null;

            const filmId = await upsertFilmStub(client, item.id, slug, item.name, item.releaseYear);
            if (!filmId) continue;
            if (wasNew || existingNeedsDetails) newFilmIds.add(filmId);

            // Write directly to live `ratings` — bypass staging since we're
            // only adding ratings for brand-new lycan-only users (no metro
            // conflicts possible because their user_ids are new).
            await client.query(
                `INSERT INTO ratings (user_id, film_id, rating, time_created, time_modified)
                 VALUES ($1, $2, $3, NOW(), NOW())
                 ON CONFLICT (user_id, film_id) DO UPDATE
                    SET rating = EXCLUDED.rating, time_modified = NOW()
                  WHERE ratings.rating <> EXCLUDED.rating`,
                [member.user_id, filmId, rating],
            );
            ingested++;
        }
    } finally {
        client.release();
    }

    // Update num_films_watched on the new user.
    try {
        const stats = await apiRequest<MemberStatistics>('GET', `/member/${encodeURIComponent(member.letterboxd_id)}/statistics`);
        const watched = stats?.counts?.watches ?? stats?.counts?.diaryEntries ?? null;
        if (watched != null) {
            await pool.query(`UPDATE users SET num_films_watched = $1, time_modified = NOW() WHERE letterboxd_id = $2`, [watched, member.letterboxd_id]);
        }
    } catch (err) {
        console.warn(`[bootstrap-lank] /statistics failed for ${member.username}: ${(err as Error).message}`);
    }
    return ingested;
}

async function appendLankRankingsAndSimilarity(): Promise<void> {
    // Remove any pre-existing 'lank' rows (idempotent re-runs).
    await pool.query(`DELETE FROM user_similarity_scores WHERE network = 'lank'`);
    await pool.query(`DELETE FROM film_rankings_history WHERE network = 'lank'`);

    // Compute lank similarity scores. Same formula as promote_and_rank.sql,
    // scoped to is_lycan=true users.
    await pool.query(`
        WITH lank_users AS (SELECT user_id FROM users WHERE is_lycan),
        user_pair_data AS (
            SELECT r1.user_id AS user_a, r2.user_id AS user_b,
                   COUNT(*) AS overlap_count,
                   AVG(ABS(r1.rating - r2.rating)) AS avg_rating_distance
              FROM ratings r1
              JOIN lank_users m1 ON r1.user_id = m1.user_id
              JOIN ratings    r2 ON r1.film_id = r2.film_id AND r1.user_id < r2.user_id
              JOIN lank_users m2 ON r2.user_id = m2.user_id
             GROUP BY r1.user_id, r2.user_id
        ),
        normalized AS (
            SELECT user_a, user_b, overlap_count, avg_rating_distance,
                   avg_rating_distance * 1.0 / NULLIF(MAX(avg_rating_distance) OVER (), 0) AS nd
              FROM user_pair_data
        ),
        scored AS (
            SELECT user_a, user_b, overlap_count, avg_rating_distance,
                   (1 - nd) * (overlap_count * 1.0 / (overlap_count + 50)) AS similarity_score
              FROM normalized
        ),
        sym AS (
            SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score FROM scored
            UNION ALL
            SELECT user_b AS user_a, user_a AS user_b, overlap_count, avg_rating_distance, similarity_score FROM scored
        )
        INSERT INTO user_similarity_scores (user_a, user_b, overlap_count, avg_rating_distance, similarity_score, network, time_computed)
        SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score, 'lank', NOW() FROM sym
    `);

    // Append lank ranking snapshot at the CURRENT max(week) of metro (so both
    // networks share the same week index going forward). We're not advancing
    // the week — that happens during the next regular promote.
    await pool.query(`
        WITH current_week AS (
            SELECT COALESCE(MAX(week), 0) AS w FROM film_rankings_history
        )
        INSERT INTO film_rankings_history (film_id, ranking, week, network, week_computed_at)
        SELECT f.film_id,
               ROW_NUMBER() OVER (ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC) AS ranking,
               (SELECT w FROM current_week),
               'lank',
               NOW()
          FROM films f
          JOIN ratings r ON f.film_id = r.film_id
          JOIN users   u ON r.user_id = u.user_id AND u.is_lycan
         WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
         GROUP BY f.film_id
        HAVING COUNT(r.rating) >= 5
         LIMIT 1000
    `);
}

async function main() {
    const t0 = Date.now();
    console.log(`[bootstrap-lank] start at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);

    // 1. discover lycandb's follows into users_stg (is_lycan=true)
    await pool.query('TRUNCATE TABLE ratings_stg; TRUNCATE TABLE users_stg CASCADE;');
    const lycanCount = await discoverMembers({ seed: 'lycandb', isLycan: true });
    console.log(`[bootstrap-lank] discovered ${lycanCount} lycan members in users_stg`);

    // 2. flag existing overlap users in live `users` as is_lycan=true
    const overlap = await pool.query(`
        UPDATE users SET is_lycan = true, time_modified = NOW()
         WHERE letterboxd_id IN (SELECT letterboxd_id FROM users_stg WHERE is_lycan)
        RETURNING user_id
    `);
    console.log(`[bootstrap-lank] flagged ${overlap.rowCount} existing users as is_lycan`);

    // 3. insert lycan-only users (those not in live `users`) into live `users`
    const inserted = await pool.query(`
        INSERT INTO users (letterboxd_id, username, display_name, num_films_watched, is_metro, is_lycan, time_created, time_modified)
        SELECT s.letterboxd_id, s.username, s.display_name, s.num_films_watched, false, true, NOW(), NOW()
          FROM users_stg s
         WHERE s.is_lycan
           AND s.letterboxd_id NOT IN (SELECT letterboxd_id FROM users WHERE letterboxd_id IS NOT NULL)
        RETURNING user_id, letterboxd_id, username
    `);
    console.log(`[bootstrap-lank] inserted ${inserted.rowCount} lycan-only users into live users`);

    // 4. pull ratings for the newly-inserted users — directly into live `ratings`
    const newFilmIds = new Set<number>();
    let totalIngested = 0;
    for (const [i, u] of inserted.rows.entries()) {
        try {
            const n = await pullRatingsLive(u as { user_id: number; letterboxd_id: string; username: string }, newFilmIds);
            totalIngested += n;
            console.log(`[bootstrap-lank] (${i + 1}/${inserted.rowCount}) ${(u as { username: string }).username}: ${n} ratings, totals: ${totalIngested} ratings / ${newFilmIds.size} new films`);
        } catch (err) {
            console.error(`[bootstrap-lank] ${(u as { username: string }).username} failed:`, (err as Error).message);
        }
    }

    // 5. fetch details + posters for newly-stubbed films
    if (newFilmIds.size > 0) {
        console.log(`[bootstrap-lank] fetching details for ${newFilmIds.size} new films`);
        const r = await syncNewFilms();
        console.log(`[bootstrap-lank] films done: ok=${r.ok}, failed=${r.failed}`);
    }

    // 6. compute lank similarity + ranking snapshot at the current week
    console.log(`[bootstrap-lank] computing lank rankings + similarity`);
    await appendLankRankingsAndSimilarity();

    const sumA = await pool.query<{ network: string; rows: string }>(`
        SELECT network, COUNT(*)::text AS rows FROM film_rankings_history GROUP BY network
    `);
    const sumB = await pool.query<{ network: string; rows: string }>(`
        SELECT network, COUNT(*)::text AS rows FROM user_similarity_scores GROUP BY network
    `);
    console.log(`[bootstrap-lank] film_rankings_history:`, sumA.rows);
    console.log(`[bootstrap-lank] user_similarity_scores:`, sumB.rows);

    // 7. clean staging so it doesn't sit half-populated for the next sync
    await pool.query('TRUNCATE TABLE ratings_stg; TRUNCATE TABLE users_stg CASCADE;');

    const dur = Math.floor((Date.now() - t0) / 1000);
    console.log(`[bootstrap-lank] done in ${Math.floor(dur / 60)}m ${dur % 60}s`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[bootstrap-lank] fatal:', err);
        pool.end().finally(() => process.exit(1));
    });
