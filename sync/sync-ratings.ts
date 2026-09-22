import fs from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
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

    const { expected } = await syncMemberStats(member, ingested);
    return { ingested, expected };
}

/**
 * Pull the member's /statistics counts and record num_films_watched.
 *
 * Deliberately separate from the ratings pull, and called again for members
 * whose ratings pull threw: the two are independent Letterboxd endpoints, and
 * a member who loses their ratings leg to a transient outage should not also
 * lose their watched count. A NULL num_films_watched is what surfaces in the
 * UI, so it is the more visible of the two failures.
 */
async function syncMemberStats(member: MemberRow, ingested: number | null): Promise<{ expected: number | undefined }> {
    const stats = await fetchMemberStats(member.letterboxd_id);
    const expected = stats?.counts?.ratings;
    const watched = stats?.counts?.watches ?? stats?.counts?.diaryEntries ?? null;
    if (expected != null && ingested != null && expected !== ingested) {
        console.warn(`[ratings] ${member.username}: ingested ${ingested} but API reports ${expected}`);
    }
    if (watched != null) {
        await pool.query(
            `UPDATE users_stg SET num_films_watched = $1, time_modified = NOW() WHERE letterboxd_id = $2`,
            [watched, member.letterboxd_id],
        );
    } else {
        // Previously silent: stats could come back without a usable count and
        // the member would keep a NULL watched count with nothing in the log.
        console.warn(`[ratings] ${member.username}: no watched count available; num_films_watched left unset`);
    }
    return { expected };
}

/**
 * Pause between the main pass and the retry pass.
 *
 * Member failures cluster: Letterboxd degrading for a few minutes takes out
 * every member whose turn falls inside that window (2026-09-20 lost 26
 * consecutive members that way). Retrying immediately would just re-hit the
 * same outage, so the retry pass waits for it to pass first.
 */
const RETRY_PASS_DELAY_MS = 5 * 60 * 1000;

export interface SyncRatingsResult {
    totalIngested: number;
    newFilmIds: Set<number>;
    /** Members still failing after the retry pass — these have incomplete data. */
    failedMembers: string[];
    memberCount: number;
}

export async function syncAllRatings(): Promise<SyncRatingsResult> {
    const { rows: members } = await pool.query<MemberRow>(
        `SELECT user_id, letterboxd_id, username FROM users_stg WHERE letterboxd_id IS NOT NULL ORDER BY user_id`,
    );
    console.log(`[ratings] syncing ${members.length} members`);
    const newFilmIds = new Set<number>();
    let totalIngested = 0;
    const failed: MemberRow[] = [];

    for (const [i, m] of members.entries()) {
        try {
            const { ingested } = await syncMemberRatings(m, newFilmIds);
            totalIngested += ingested;
            if ((i + 1) % 10 === 0 || i === members.length - 1) {
                console.log(`[ratings] ${i + 1}/${members.length} (${m.username}: ${ingested}, total: ${totalIngested}, new films: ${newFilmIds.size})`);
            }
        } catch (err) {
            console.error(`[ratings] member ${m.username} failed:`, err.message);
            failed.push(m);
            // The ratings pull threw before the stats call it normally ends
            // with, so make that call here. It is a different endpoint and
            // usually still answers, which keeps the member's watched count
            // (the part the UI shows) out of the blast radius.
            try {
                await syncMemberStats(m, null);
            } catch (statsErr) {
                console.error(`[ratings] member ${m.username} stats fallback failed:`, statsErr.message);
            }
        }
    }

    if (failed.length === 0) return { totalIngested, newFilmIds, failedMembers: [], memberCount: members.length };

    console.warn(`[ratings] ${failed.length}/${members.length} members failed the first pass; retrying in ${RETRY_PASS_DELAY_MS / 60000}m`);
    await sleep(RETRY_PASS_DELAY_MS);

    const stillFailed: string[] = [];
    for (const m of failed) {
        try {
            const { ingested } = await syncMemberRatings(m, newFilmIds);
            totalIngested += ingested;
            console.log(`[ratings] retry ok: ${m.username} (${ingested}, total: ${totalIngested})`);
        } catch (err) {
            console.error(`[ratings] retry failed: ${m.username}:`, err.message);
            stillFailed.push(m.username);
        }
    }

    if (stillFailed.length > 0) {
        console.error(`[ratings] ${stillFailed.length} member(s) incomplete after retry: ${stillFailed.join(', ')}`);
    } else {
        console.log(`[ratings] retry pass recovered all ${failed.length} member(s)`);
    }

    return { totalIngested, newFilmIds, failedMembers: stillFailed, memberCount: members.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncAllRatings()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[ratings] fatal:', err);
            process.exit(1);
        });
}
