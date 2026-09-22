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
 * How often to re-probe Letterboxd while waiting out an outage.
 *
 * Member failures cluster: Letterboxd degrading for a few minutes takes out
 * every member whose turn falls inside that window (2026-09-20 lost 26
 * consecutive members that way, and the resulting week's rankings were wrong).
 * Rather than push on through an outage and salvage what we can, the sync
 * stops on the first failure and waits for Letterboxd to come back.
 */
const OUTAGE_POLL_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Ceiling on total time spent waiting for Letterboxd across one sync run.
 *
 * Without a ceiling a sustained outage would leave the sync running forever,
 * holding staging half-populated with no alert. At this point the run gives up
 * and reports which members are incomplete; the pre-promote check then blocks
 * the week rather than publishing wrong rankings.
 */
const OUTAGE_MAX_TOTAL_WAIT_MS = 12 * 60 * 60 * 1000;

/** Attempts per member before it is treated as a member-specific problem. */
const MAX_ATTEMPTS_PER_MEMBER = 3;

export interface SyncRatingsResult {
    totalIngested: number;
    newFilmIds: Set<number>;
    /** Members still incomplete when the run ended. Empty means a clean week. */
    failedMembers: string[];
    memberCount: number;
    /** Total time spent waiting out Letterboxd outages, in ms. */
    outageWaitMs: number;
}

/**
 * Cheap liveness probe against the endpoint that actually fails during an
 * outage. A single one-item page is enough to tell "Letterboxd is answering"
 * from "Letterboxd is down", without burning quota.
 */
async function letterboxdHealthy(): Promise<boolean> {
    try {
        await apiRequest('GET', '/films', { query: { perPage: '1' }, maxRetries: 1, timeoutMs: 10000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Block until Letterboxd answers again, or until the run's outage budget is
 * spent. Returns the time waited; the caller adds it to the running total.
 */
async function waitForLetterboxd(alreadyWaitedMs: number): Promise<{ recovered: boolean; waitedMs: number }> {
    const started = Date.now();
    let waited = 0;

    while (alreadyWaitedMs + waited < OUTAGE_MAX_TOTAL_WAIT_MS) {
        console.warn(`[ratings] Letterboxd unreachable — re-probing in ${OUTAGE_POLL_INTERVAL_MS / 60000}m `
            + `(waited ${Math.round((alreadyWaitedMs + waited) / 60000)}m of ${OUTAGE_MAX_TOTAL_WAIT_MS / 3600000}h budget)`);
        await sleep(OUTAGE_POLL_INTERVAL_MS);
        waited = Date.now() - started;

        if (await letterboxdHealthy()) {
            console.log(`[ratings] Letterboxd is answering again after ${Math.round(waited / 60000)}m — resuming`);
            return { recovered: true, waitedMs: waited };
        }
    }

    console.error(`[ratings] gave up waiting for Letterboxd after ${Math.round((alreadyWaitedMs + waited) / 60000)}m`);
    return { recovered: false, waitedMs: waited };
}

export async function syncAllRatings(): Promise<SyncRatingsResult> {
    const { rows: members } = await pool.query<MemberRow>(
        `SELECT user_id, letterboxd_id, username FROM users_stg WHERE letterboxd_id IS NOT NULL ORDER BY user_id`,
    );
    console.log(`[ratings] syncing ${members.length} members`);
    const newFilmIds = new Set<number>();
    let totalIngested = 0;
    let outageWaitMs = 0;
    let outageEpisodes = 0;
    const failedMembers: string[] = [];

    // Index-based rather than for..of: a member whose failure turns out to be
    // an outage is retried in place after the wait, so the cursor only advances
    // once that member has actually been ingested. Nothing is skipped.
    for (let i = 0; i < members.length; i++) {
        const m = members[i];
        let attempts = 0;

        while (true) {
            attempts++;
            try {
                const { ingested } = await syncMemberRatings(m, newFilmIds);
                totalIngested += ingested;
                if ((i + 1) % 10 === 0 || i === members.length - 1) {
                    console.log(`[ratings] ${i + 1}/${members.length} (${m.username}: ${ingested}, total: ${totalIngested}, new films: ${newFilmIds.size})`);
                }
                break;
            } catch (err) {
                console.error(`[ratings] member ${m.username} failed (attempt ${attempts}):`, err.message);

                // Distinguish "Letterboxd is down" from "this member is a
                // problem". Only the former is worth suspending the run for;
                // a deleted or private account would otherwise stall it.
                if (!(await letterboxdHealthy())) {
                    outageEpisodes++;
                    const { recovered, waitedMs } = await waitForLetterboxd(outageWaitMs);
                    outageWaitMs += waitedMs;
                    if (recovered) {
                        attempts = 0; // the outage was not this member's fault
                        continue;
                    }
                    // Budget spent and Letterboxd is still down. Record every
                    // remaining member as incomplete rather than spinning
                    // through them against a dead API.
                    for (let j = i; j < members.length; j++) failedMembers.push(members[j].username);
                    console.error(`[ratings] abandoning run with ${members.length - i} member(s) unprocessed`);
                    return { totalIngested, newFilmIds, failedMembers, memberCount: members.length, outageWaitMs };
                }

                if (attempts >= MAX_ATTEMPTS_PER_MEMBER) {
                    console.error(`[ratings] ${m.username}: ${attempts} attempts against a healthy Letterboxd; treating as member-specific`);
                    failedMembers.push(m.username);
                    // Different endpoint, usually still answers — keeps the
                    // watched count out of the blast radius.
                    try {
                        await syncMemberStats(m, null);
                    } catch (statsErr) {
                        console.error(`[ratings] ${m.username} stats fallback failed:`, statsErr.message);
                    }
                    break;
                }
            }
        }
    }

    if (outageEpisodes > 0) {
        console.log(`[ratings] rode out ${outageEpisodes} Letterboxd outage(s), ${Math.round(outageWaitMs / 60000)}m waiting in total`);
    }
    if (failedMembers.length > 0) {
        console.error(`[ratings] ${failedMembers.length} member(s) incomplete: ${failedMembers.join(', ')}`);
    }

    return { totalIngested, newFilmIds, failedMembers, memberCount: members.length, outageWaitMs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncAllRatings()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[ratings] fatal:', err);
            process.exit(1);
        });
}
