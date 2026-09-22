/**
 * Repair NULL num_films_watched on the live users table.
 *
 * When a member's leg of the weekly sync fails, they land in `users` with a
 * NULL watched count and keep it until the next successful sync a week later.
 * The count is cheap to recover — one /member/:id/statistics call each — so
 * this fills the gap in place rather than waiting a week.
 *
 * Only touches rows where num_films_watched IS NULL, so it is safe to re-run
 * and never overwrites a good value with a worse one.
 *
 * Note this repairs the watched count only. A member who also lost their
 * ratings pull stays missing from the rankings until the next full sync +
 * promote recomputes them.
 *
 *   node dist/scripts/backfill-watched.js --dry-run   # report, change nothing
 *   node dist/scripts/backfill-watched.js
 */
import 'dotenv/config';
import '../lib/log-timestamps.js';
import pool from '../db/conn.js';
import { apiRequest } from '../sync/lbx-client.js';

interface TargetRow {
    user_id: number;
    username: string;
    letterboxd_id: string;
}

interface MemberStatistics {
    counts?: { watches?: number; diaryEntries?: number };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`[backfill-watched] start${dryRun ? ' (DRY RUN)' : ''}`);

    const { rows: targets } = await pool.query<TargetRow>(`
        SELECT user_id, username, letterboxd_id
        FROM users
        WHERE num_films_watched IS NULL AND letterboxd_id IS NOT NULL
        ORDER BY user_id
    `);

    if (targets.length === 0) {
        console.log('[backfill-watched] nothing to do — no NULL watched counts');
        return;
    }
    console.log(`[backfill-watched] ${targets.length} member(s) missing a watched count`);

    let updated = 0, failed = 0;
    for (const t of targets) {
        try {
            const stats = await apiRequest<MemberStatistics>('GET', `/member/${encodeURIComponent(t.letterboxd_id)}/statistics`);
            const watched = stats?.counts?.watches ?? stats?.counts?.diaryEntries ?? null;
            if (watched == null) {
                console.warn(`[backfill-watched] ${t.username}: API returned no usable count`);
                failed++;
                continue;
            }
            if (dryRun) {
                console.log(`[backfill-watched] would set ${t.username} = ${watched}`);
            } else {
                await pool.query(
                    `UPDATE users SET num_films_watched = $1, time_modified = NOW() WHERE user_id = $2`,
                    [watched, t.user_id],
                );
                console.log(`[backfill-watched] ${t.username} = ${watched}`);
            }
            updated++;
        } catch (err) {
            console.error(`[backfill-watched] ${t.username} failed:`, err.message);
            failed++;
        }
    }

    console.log(`[backfill-watched] done: ${updated} ${dryRun ? 'would be updated' : 'updated'}, ${failed} failed`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[backfill-watched] fatal:', err);
        pool.end().finally(() => process.exit(1));
    });
