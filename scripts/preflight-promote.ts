/**
 * The gate the weekly promote runs behind. Exits 0 to allow it, 1 to hold.
 *
 * Context: on 2026-09-20 Letterboxd degraded for several minutes mid-sync. The
 * per-member try/catch in syncAllRatings swallowed 26 consecutive failures, the
 * sync reported success, and promote swapped the incomplete data into the live
 * tables. Nothing alerted, because nothing had failed loudly.
 *
 * Policy is zero tolerance. The rankings are an average across the whole
 * community, so a member missing their ratings doesn't merely omit that member
 * — it shifts every film they would have rated. A "mostly complete" week is a
 * wrong week, not a slightly stale one.
 *
 * This checks the staging rows about to go live rather than parsing logs: an
 * invariant on the data itself can't be fooled by a job that exited 0.
 *
 * Designed to be run repeatedly (the crontab fires it hourly through Monday)
 * so a week still lands after the sync has spent hours waiting out an outage.
 * The three hold conditions are ordered cheapest-first and all no-op quietly;
 * only a genuinely stuck week emails, and only once per week.
 */
import 'dotenv/config';
import '../lib/log-timestamps.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pool from '../db/conn.js';
import { sendCriticalAlert } from '../lib/alert.js';

const execFileAsync = promisify(execFile);

/**
 * How long after the week rolls over before an unpromoted week is treated as
 * stuck rather than merely late. The sync can legitimately spend hours waiting
 * out a Letterboxd outage; this is comfortably past that but still leaves most
 * of Monday to react.
 */
const STUCK_AFTER_HOURS = 14;

interface IncompleteMember {
    username: string;
    num_films_watched: number | null;
    rating_count: number;
}

/** True once this week's rankings have been computed — makes reruns no-ops. */
async function alreadyPromotedThisWeek(): Promise<boolean> {
    const { rows } = await pool.query<{ done: boolean }>(`
        SELECT COALESCE(
            MAX(week_computed_at AT TIME ZONE 'America/New_York')
                >= date_trunc('week', NOW() AT TIME ZONE 'America/New_York'),
            false
        ) AS done
        FROM film_rankings_history
        WHERE network = 'metro'
    `);
    return rows[0]?.done === true;
}

/** Hours since the current week began (Monday 00:00 ET). */
async function hoursIntoWeek(): Promise<number> {
    const { rows } = await pool.query<{ hrs: string }>(`
        SELECT EXTRACT(EPOCH FROM (
            (NOW() AT TIME ZONE 'America/New_York') - date_trunc('week', NOW() AT TIME ZONE 'America/New_York')
        )) / 3600 AS hrs
    `);
    return Number(rows[0]?.hrs ?? 0);
}

/** A sync still running means staging is mid-write, not broken. */
async function syncInProgress(): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('pgrep', ['-f', 'dist/sync/index.js']);
        return stdout.trim().length > 0;
    } catch {
        // pgrep exits 1 when nothing matches.
        return false;
    }
}

async function findIncompleteMembers(): Promise<IncompleteMember[]> {
    // Two independent symptoms of a failed sync leg:
    //
    //   1. No watched count. The /statistics call never landed. This is the
    //      exact state the 2026-09-20 outage left 26 members in, and it is
    //      what breaks the members page.
    //
    //   2. Ratings went from some to none. The /films pull failed for a member
    //      who demonstrably had ratings last week.
    //
    // Note what is deliberately NOT flagged: a member with zero ratings who
    // also had zero last week. Plenty of members log films without rating them
    // — 20 of the current 355 — so a bare "0 ratings" test condemns a clean
    // sync. The comparison is against the live tables, which at preflight time
    // still hold last week's data because staging has not been promoted yet.
    const { rows } = await pool.query<IncompleteMember>(`
        WITH stg AS (
            SELECT u.user_id, u.username, u.num_films_watched,
                   COUNT(r.rating)::int AS rating_count
              FROM users_stg u
              LEFT JOIN ratings_stg r ON r.user_id = u.user_id
             GROUP BY u.user_id, u.username, u.num_films_watched
        ),
        live AS (
            SELECT lu.username, COUNT(lr.rating)::int AS rating_count
              FROM users lu
              LEFT JOIN ratings lr ON lr.user_id = lu.user_id
             GROUP BY lu.username
        )
        SELECT stg.username, stg.num_films_watched, stg.rating_count
          FROM stg
          LEFT JOIN live ON live.username = stg.username
         WHERE stg.num_films_watched IS NULL
            OR (stg.rating_count = 0 AND COALESCE(live.rating_count, 0) > 0)
         ORDER BY stg.username
    `);
    return rows;
}

/** Emails at most once per week, so hourly reruns don't become hourly mail. */
async function alertOncePerWeek(subject: string, body: string): Promise<void> {
    const { rows } = await pool.query<{ fresh: boolean }>(`
        INSERT INTO promote_alert_log (week_start, subject)
        VALUES (date_trunc('week', NOW() AT TIME ZONE 'America/New_York'), $1)
        ON CONFLICT (week_start, subject) DO NOTHING
        RETURNING true AS fresh
    `, [subject]);
    if (rows.length === 0) {
        console.log(`[preflight] already alerted this week for "${subject}" — staying quiet`);
        return;
    }
    await sendCriticalAlert(subject, body);
}

async function main(): Promise<number> {
    // --redo: deliberately recompute a week that has already been promoted,
    // for when its source data turned out to be wrong. Pairs with
    // `promote --same-week`, which keeps the week number from advancing.
    // The completeness checks below still apply in full.
    const redo = process.argv.includes('--redo');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS promote_alert_log (
            week_start date NOT NULL,
            subject    text NOT NULL,
            sent_at    timestamptz NOT NULL DEFAULT NOW(),
            PRIMARY KEY (week_start, subject)
        )
    `);

    if (await alreadyPromotedThisWeek()) {
        if (!redo) {
            console.log('[preflight] this week is already promoted — nothing to do');
            return 1;
        }
        console.log('[preflight] --redo: this week is already promoted, recomputing it anyway');
    }

    if (await syncInProgress()) {
        console.log('[preflight] a sync is still running — holding until it finishes');
        return 1;
    }

    const { rows: [{ total }] } = await pool.query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM users_stg',
    );
    const memberCount = Number(total);
    const hrs = await hoursIntoWeek();

    // Empty staging means the sync hasn't populated it (or was wiped).
    // Promoting that would truncate the live tables and take the site down.
    if (memberCount === 0) {
        console.log(`[preflight] staging is empty (${hrs.toFixed(1)}h into the week)`);
        if (hrs >= STUCK_AFTER_HOURS) {
            await alertOncePerWeek(
                'promote STUCK — staging is empty',
                `users_stg has 0 rows and it is ${hrs.toFixed(1)}h into the week, so the sync has not\n` +
                `populated staging. Promoting would truncate the live tables, so it is being held.\n` +
                `The live site still shows last week's data.\n\n` +
                `Check the most recent dumps/sync_*.log and dumps/resync_*.log on the VPS.`,
            );
        }
        return 1;
    }

    const incomplete = await findIncompleteMembers();
    console.log(`[preflight] ${memberCount} members in staging, ${incomplete.length} incomplete, ${hrs.toFixed(1)}h into the week`);

    if (incomplete.length === 0) {
        console.log('[preflight] OK — promote may proceed');
        return 0;
    }

    // Incomplete but no sync running: the sync gave up, or died. The hourly
    // rerun keeps checking in case a manual re-sync fixes it.
    const detail = incomplete
        .map((m) => `  ${m.username}: watched=${m.num_films_watched ?? 'NULL'}, ratings=${m.rating_count}`)
        .join('\n');
    console.error(`[preflight] HOLDING — ${incomplete.length}/${memberCount} members incomplete`);

    if (hrs >= STUCK_AFTER_HOURS) {
        await alertOncePerWeek(
            `promote STUCK — ${incomplete.length}/${memberCount} members incomplete`,
            `${incomplete.length} of ${memberCount} members have incomplete data in staging and no sync is\n` +
            `running, ${hrs.toFixed(1)}h into the week. The promote is being held, so the live site still\n` +
            `shows last week's complete data.\n\n` +
            `Incomplete members:\n${detail}\n\n` +
            `The sync waits out a Letterboxd outage on its own and resumes, so reaching this\n` +
            `point means the outage outlasted that wait or the sync died.\n\n` +
            `To retry by hand:\n` +
            `  cd /root/mkdb && npm run sync\n` +
            `The hourly promote check will pick it up automatically once staging is complete.`,
        );
    }
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
            'promote held — preflight check itself failed',
            `The pre-promote data check threw before it could reach a verdict:\n\n${err?.stack || err}\n\n` +
            `The promote was held as a precaution.`,
        );
        await pool.end().catch(() => {});
        process.exit(1);
    });
