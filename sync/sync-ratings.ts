import fs from 'fs';
import path from 'path';
import pool from '../db/conn.js';
import { apiRequest, paginate } from './lbx-client.js';
import type { PoolClient } from 'pg';

const POSTER_DIR = path.resolve('images/posters');

interface FilmStubInput {
    lid: string;
    slug: string;
    title?: string;
    year?: number | null;
}

interface RatingInput {
    userId: number;
    filmId: number;
    rating: number;
}

interface MemberRow {
    user_id: number;
    letterboxd_id: string;
    username: string;
}

interface LetterboxdFilmListItem {
    id?: string;
    link?: string;
    name?: string;
    releaseYear?: number;
    relationships?: Array<{
        relationship?: {
            rating?: number;
        };
    }>;
}

function slugFromLink(link?: string): string | null {
    if (!link) return null;
    const m = link.match(/\/film\/([^/]+)\/?/);
    return m ? m[1].toLowerCase() : null;
}

// Letterboxd slugs can change (e.g. "barbie" → "barbie-2023"). LID is the only stable
// identifier. When a slug change is detected on an existing row, update the slug and
// rename the on-disk poster file. If the slug change collides with another row's slug,
// keep the old slug — we'd rather have stale data than break uniqueness.
async function applySlugChange(client: PoolClient, lid: string, oldSlug: string, newSlug: string): Promise<void> {
    try {
        await client.query(
            `UPDATE films SET slug = $1, time_modified = NOW() WHERE letterboxd_id = $2`,
            [newSlug, lid],
        );
    } catch (err) {
        if (err.code === '23505') {
            console.warn(`[ratings] slug rename ${oldSlug} -> ${newSlug} collides for ${lid}; keeping old slug`);
            return;
        }
        throw err;
    }
    const oldPath = path.join(POSTER_DIR, `${oldSlug}.jpg`);
    const newPath = path.join(POSTER_DIR, `${newSlug}.jpg`);
    try {
        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
            fs.renameSync(oldPath, newPath);
        }
    } catch (err) {
        console.warn(`[ratings] could not rename poster ${oldPath} -> ${newPath}: ${err.message}; flagging for re-fetch`);
        await client.query(
            `UPDATE films SET details_fetched_at = NULL WHERE letterboxd_id = $1`,
            [lid],
        );
    }
}

async function upsertFilmStub(client: PoolClient, { lid, slug, title, year }: FilmStubInput): Promise<number | null> {
    if (!lid || !slug) return null;

    const existing = await client.query<{ film_id: number; slug: string; details_fetched_at?: Date | null }>(
        `SELECT film_id, slug FROM films WHERE letterboxd_id = $1`,
        [lid],
    );
    if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0];
        if (row.slug !== slug) {
            await applySlugChange(client, lid, row.slug, slug);
        }
        return row.film_id;
    }

    try {
        const r = await client.query<{ film_id: number }>(
            `INSERT INTO films (letterboxd_id, slug, title, year, time_created, time_modified)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             RETURNING film_id`,
            [lid, slug, title || slug, year ?? null],
        );
        return r.rows[0].film_id;
    } catch (err) {
        if (err.code !== '23505') throw err;
        // Slug already exists on a row with NULL letterboxd_id — adopt it.
        const r = await client.query<{ film_id: number }>(
            `UPDATE films
                SET letterboxd_id = $1,
                    time_modified = NOW()
              WHERE slug = $2 AND letterboxd_id IS NULL
              RETURNING film_id`,
            [lid, slug],
        );
        if ((r.rowCount ?? 0) > 0) return r.rows[0].film_id;
        console.warn(`[ratings] slug "${slug}" already mapped to a different LID, skipping ${lid}`);
        return null;
    }
}

async function upsertRating(client: PoolClient, { userId, filmId, rating }: RatingInput): Promise<void> {
    await client.query(
        `INSERT INTO ratings_stg (user_id, film_id, rating, time_created, time_modified)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id, film_id) DO UPDATE
            SET rating = EXCLUDED.rating,
                time_modified = NOW()
          WHERE ratings_stg.rating <> EXCLUDED.rating`,
        [userId, filmId, rating],
    );
}

interface MemberStatistics {
    counts?: {
        ratings?: number;
        watches?: number;
        diaryEntries?: number;
    };
}

async function fetchMemberStats(lid: string): Promise<MemberStatistics | null> {
    try {
        return await apiRequest<MemberStatistics>('GET', `/member/${encodeURIComponent(lid)}/statistics`);
    } catch (err) {
        console.warn(`[ratings] /statistics failed for ${lid}:`, err.message);
        return null;
    }
}

async function syncMemberRatings(member: MemberRow, newFilmIds: Set<number>): Promise<{ ingested: number; expected: number | undefined }> {
    const client = await pool.connect();
    let ingested = 0;
    try {
        for await (const item of paginate<LetterboxdFilmListItem>('/films', { member: member.letterboxd_id, memberRelationship: 'Rated', perPage: '100' })) {
            const rel = item?.relationships?.[0]?.relationship;
            const rating = rel?.rating;
            if (rating == null || !item.id) continue;

            const slug = slugFromLink(item.link);
            if (!slug) continue;

            const existing = await client.query<{ film_id: number; details_fetched_at: Date | null }>(
                `SELECT film_id, details_fetched_at FROM films WHERE letterboxd_id = $1`,
                [item.id],
            );
            const rowCount = existing.rowCount ?? 0;
            const wasNew = rowCount === 0;
            const existingNeedsDetails = rowCount > 0 && existing.rows[0].details_fetched_at == null;

            const filmId = await upsertFilmStub(client, {
                lid: item.id,
                slug,
                title: item.name,
                year: item.releaseYear,
            });
            if (!filmId) continue;

            if (wasNew || existingNeedsDetails) newFilmIds.add(filmId);

            await upsertRating(client, { userId: member.user_id, filmId, rating });
            ingested++;
        }
    } finally {
        client.release();
    }

    const stats = await fetchMemberStats(member.letterboxd_id);
    const expected = stats?.counts?.ratings;
    const watched = stats?.counts?.watches ?? stats?.counts?.diaryEntries ?? null;
    if (expected != null && expected !== ingested) {
        console.warn(`[ratings] ${member.username}: ingested ${ingested} but API reports ${expected}`);
    }
    if (watched != null) {
        await pool.query(
            `UPDATE users_stg SET num_films_watched = $1, time_modified = NOW() WHERE letterboxd_id = $2`,
            [watched, member.letterboxd_id],
        );
    }
    return { ingested, expected };
}

export async function syncAllRatings(): Promise<{ totalIngested: number; newFilmIds: Set<number> }> {
    const { rows: members } = await pool.query<MemberRow>(
        `SELECT user_id, letterboxd_id, username FROM users_stg WHERE letterboxd_id IS NOT NULL ORDER BY user_id`,
    );
    console.log(`[ratings] syncing ${members.length} members`);
    const newFilmIds = new Set<number>();
    let totalIngested = 0;

    for (const [i, m] of members.entries()) {
        try {
            const { ingested } = await syncMemberRatings(m, newFilmIds);
            totalIngested += ingested;
            if ((i + 1) % 10 === 0 || i === members.length - 1) {
                console.log(`[ratings] ${i + 1}/${members.length} (${m.username}: ${ingested}, total: ${totalIngested}, new films: ${newFilmIds.size})`);
            }
        } catch (err) {
            console.error(`[ratings] member ${m.username} failed:`, err.message);
        }
    }
    return { totalIngested, newFilmIds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncAllRatings()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[ratings] fatal:', err);
            process.exit(1);
        });
}
