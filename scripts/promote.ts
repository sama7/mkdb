import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import pool from '../db/conn.js';
import type { PoolClient, QueryResult } from 'pg';

const SQL_PATH = path.resolve('sql/promote_and_rank.sql');
const POSTER_DIR = path.resolve('images/posters');

/**
 * Drop the newest ranking week per network so the promote that follows reuses
 * that week number instead of advancing past it.
 *
 * promote_and_rank.sql derives the week as MAX(week) + 1 per network, so
 * re-running a promote normally burns a week number. When a week has to be
 * recomputed — the source data for it turned out to be incomplete — the
 * published week number should not move, or every downstream reference to
 * "week N" (the Letterboxd list, the #mank post) silently means something
 * different. Deleting the current top week first makes MAX + 1 land back on
 * the same number.
 *
 * Only ever deletes the single newest week per network. The trim step in the
 * SQL keeps three weeks, so the two prior weeks that risers/fallers compare
 * against are untouched.
 */
async function dropCurrentWeek(client: PoolClient): Promise<void> {
    const { rows } = await client.query<{ network: string; max_w: number }>(
        `SELECT network, MAX(week) AS max_w FROM film_rankings_history GROUP BY network`,
    );
    if (rows.length === 0) {
        console.log('[promote] --same-week: no ranking history yet, nothing to drop');
        return;
    }
    for (const { network, max_w } of rows) {
        const res = await client.query(
            `DELETE FROM film_rankings_history WHERE network = $1 AND week = $2`,
            [network, max_w],
        );
        console.log(`[promote] --same-week: dropped ${res.rowCount} rows for ${network} week ${max_w} (will be recomputed as week ${max_w})`);
    }
}

export async function runPromote(opts: { sameWeek?: boolean } = {}) {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');

    const client = await pool.connect();
    let orphanSlugs: string[] = [];
    try {
        if (opts.sameWeek) {
            // Dropping the current week and recomputing it has to be atomic:
            // if the drop committed and the promote then failed, the week would
            // be gone with nothing to replace it. An explicit transaction means
            // a failure leaves the existing week untouched.
            await client.query('BEGIN');
            try {
                await dropCurrentWeek(client);
                const result = await client.query(sql);
                const last = (Array.isArray(result) ? result[result.length - 1] : result) as QueryResult<{ slug?: string }>;
                orphanSlugs = (last?.rows ?? []).map((r) => r.slug).filter(Boolean) as string[];
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                console.error('[promote] --same-week: rolled back, the existing week is intact');
                throw err;
            }
        } else {
            const result = await client.query(sql);
            // node-postgres returns the last command's result for multi-statement queries.
            // The trailing SELECT in promote_and_rank.sql returns the deleted orphan slugs.
            const last = (Array.isArray(result) ? result[result.length - 1] : result) as QueryResult<{ slug?: string }>;
            orphanSlugs = (last?.rows ?? []).map((r) => r.slug).filter(Boolean) as string[];
        }
    } finally {
        client.release();
    }

    console.log(`[promote] SQL completed. ${orphanSlugs.length} orphan films deleted.`);

    let removed = 0, missing = 0, failed = 0;
    for (const slug of orphanSlugs) {
        const p = path.join(POSTER_DIR, `${slug}.jpg`);
        try {
            fs.unlinkSync(p);
            removed++;
        } catch (err) {
            if (err.code === 'ENOENT') missing++;
            else { failed++; console.warn(`[promote] could not unlink ${p}: ${err.message}`); }
        }
    }

    console.log(`[promote] posters: removed=${removed}, already-missing=${missing}, failed=${failed}`);
    return { orphanCount: orphanSlugs.length, postersRemoved: removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    // --same-week: recompute the current week in place rather than advancing
    // the counter. For redoing a week whose sync data was incomplete.
    const sameWeek = process.argv.includes('--same-week');
    if (sameWeek) console.log('[promote] --same-week: current ranking week will be replaced, not advanced');
    runPromote({ sameWeek })
        .then(() => pool.end())
        .catch((err) => {
            console.error('[promote] fatal:', err);
            pool.end().finally(() => process.exit(1));
        });
}
