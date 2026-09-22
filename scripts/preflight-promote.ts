/**
 * Data-completeness gate, run immediately before the weekly promote.
 *
 * Context: on 2026-09-20 Letterboxd degraded for several minutes mid-sync. The
 * per-member try/catch in syncAllRatings swallowed 26 consecutive failures, the
 * sync reported success, and promote swapped that incomplete data into the live
 * tables. Those 26 members landed with a NULL num_films_watched, which (a) sorts
 * first under `ORDER BY num_films_watched DESC` and (b) crashed the members
 * page client-side. Nothing alerted, because nothing had failed loudly.
 *
 * So this checks the staging data *about to go live* rather than parsing logs:
 * an invariant on the rows themselves can't be fooled by a job that exited 0.
 *
 * Policy: zero tolerance. Any incomplete member blocks the promote.
 *
 * The rankings are an average across the whole community, so a member missing
 * their ratings doesn't just omit that member — it shifts every film they would
 * have rated. A "mostly complete" week is a wrong week, not a slightly stale
 * one. Blocking keeps last week's correct data live until the sync is redone.
 *
 * Exits 0 to allow the promote, 1 to block it. The crontab runs it as the first
 * link of the `&&` chain, so a non-zero exit stops the whole weekly pipeline.
 */
import 'dotenv/config';
import '../lib/log-timestamps.js';
import pool from '../db/conn.js';
import { sendCriticalAlert } from '../lib/alert.js';

/** Zero tolerance: any incomplete member blocks the promote. */
const BLOCK_THRESHOLD = 0;

interface IncompleteMember {
    username: string;
    num_films_watched: number | null;
    rating_count: number;
}

async function findIncompleteMembers(): Promise<IncompleteMember[]> {
    // A member is "incomplete" if either leg of their sync didn't land: no
    // watched count (the /statistics call), or no ratings at all (the /films
    // pull). Both are symptoms of the same transient-failure mode.
    const { rows } = await pool.query<IncompleteMember>(`
        SELECT
            u.username,
            u.num_films_watched,
            COUNT(r.rating)::int AS rating_count
        FROM users_stg u
        LEFT JOIN ratings_stg r ON r.user_id = u.user_id
        GROUP BY u.user_id, u.username, u.num_films_watched
        HAVING u.num_films_watched IS NULL OR COUNT(r.rating) = 0
        ORDER BY u.username
    `);
    return rows;
}

async function main() {
    const { rows: [{ total }] } = await pool.query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM users_stg',
    );
    const memberCount = Number(total);

    // An empty staging table means the sync didn't run or was wiped; promoting
    // that would truncate the live tables and take the whole site down.
    if (memberCount === 0) {
        await sendCriticalAlert(
            'promote BLOCKED — staging is empty',
            'users_stg has 0 rows. The weekly sync did not populate staging, and promoting\n' +
            'would truncate the live tables. Promote was blocked; the live site still has\n' +
            'last week\'s data.\n\n' +
            'Check the most recent dumps/sync_*.log on the VPS.',
        );
        return 1;
    }

    const incomplete = await findIncompleteMembers();
    console.log(`[preflight] ${memberCount} members in staging, ${incomplete.length} incomplete`);

    if (incomplete.length === 0) {
        console.log('[preflight] OK — promote may proceed');
        return 0;
    }

    const detail = incomplete
        .map((m) => `  ${m.username}: watched=${m.num_films_watched ?? 'NULL'}, ratings=${m.rating_count}`)
        .join('\n');

    await sendCriticalAlert(
        `promote BLOCKED — ${incomplete.length}/${memberCount} members incomplete`,
        `${incomplete.length} of ${memberCount} members have incomplete data in staging, so the\n` +
        `promote was BLOCKED. The live site still shows last week's complete data.\n\n` +
        `Incomplete members:\n${detail}\n\n` +
        `Usual cause is Letterboxd being unreachable during those members' leg of the sync.\n` +
        `Check the most recent dumps/sync_*.log for "[ratings] member ... failed".\n\n` +
        `The sync normally waits out a Letterboxd outage and resumes on its own, so\n` +
        `reaching this point means the outage outlasted that wait. To retry by hand:\n` +
        `  cd /root/mkdb && npm run sync && npm run preflight-promote && npm run promote`,
    );

    return 1;
}

main()
    .then(async (code) => {
        await pool.end();
        process.exit(code);
    })
    .catch(async (err) => {
        console.error('[preflight] fatal:', err);
        // A gate that can't run is not a reason to promote blindly.
        await sendCriticalAlert(
            'promote BLOCKED — preflight check itself failed',
            `The pre-promote data check threw before it could reach a verdict:\n\n${err?.stack || err}\n\n` +
            `Promote was blocked as a precaution.`,
        );
        await pool.end().catch(() => {});
        process.exit(1);
    });
