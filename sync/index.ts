import 'dotenv/config';
import pool from '../db/conn.js';
import { discoverMembers } from './discover-members.js';
import { syncAllRatings } from './sync-ratings.js';
import { syncNewFilms } from './sync-films.js';
import { sendCriticalAlert } from '../lib/alert.js';

// Orchestrator order matters:
// 0. Truncate staging tables so each run starts clean.
// 1a. Enumerate the metrodb-following community into users_stg (is_metro=true).
// 1b. Enumerate the lycandb-following community, OR-merging is_lycan=true
//     onto existing rows. Users followed by both end up with both flags set
//     on one row (no duplication of users or ratings).
// 2. Pull every member's ratings into ratings_stg, stubbing new films into `films`.
//    Network-agnostic — a user in users_stg is pulled once regardless of which
//    network(s) they belong to. On a Letterboxd outage this stops and waits
//    rather than skipping members: a partial community produces wrong averages,
//    not merely a thinner list.
// 3. Sync film details + posters for all new films (details_fetched_at IS NULL).
//
// Promote (swap staging → live, recompute similarity per network, append the
// new ranking week per network, trim history to 3 weeks, delete orphan films
// + their posters) is run SEPARATELY via `npm run promote`. The two stages
// are scheduled by cron at different times so they can be timed and monitored
// independently.

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

async function main() {
    const t0 = Date.now();
    console.log(`[sync] start at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true })} EDT`);

    await pool.query('TRUNCATE TABLE ratings_stg; TRUNCATE TABLE users_stg CASCADE;');
    console.log('[sync] staging tables cleared');

    const tDiscover = Date.now();
    const metroCount = await discoverMembers({ seed: 'metrodb', isMetro: true });
    const lycanCount = await discoverMembers({ seed: 'lycandb', isLycan: true });
    const { rows: [{ total }] } = await pool.query<{ total: string }>('SELECT COUNT(*) AS total FROM users_stg');
    console.log(`[sync] discovered metro=${metroCount}, lycan=${lycanCount}, union=${total} members in ${formatDuration(Date.now() - tDiscover)}`);

    const tRatings = Date.now();
    const { totalIngested, failedMembers, memberCount, outageWaitMs } = await syncAllRatings();
    console.log(`[sync] ratings ingested: ${totalIngested} in ${formatDuration(Date.now() - tRatings)}`);
    if (failedMembers.length > 0) {
        console.error(`[sync] ${failedMembers.length}/${memberCount} members incomplete: ${failedMembers.join(', ')}`);
    }

    const tFilms = Date.now();
    const filmsResult = await syncNewFilms();
    console.log(`[sync] film details: ok=${filmsResult.ok}, failed=${filmsResult.failed}, total=${filmsResult.total} in ${formatDuration(Date.now() - tFilms)}`);

    console.log(`[sync] done in ${formatDuration(Date.now() - t0)} (staging populated; run \`npm run promote\` to swap into live)`);

    // The pre-promote gate is what actually blocks bad data from going live
    // (see scripts/preflight-promote.ts); this is the earlier heads-up, sent
    // hours before promote runs so there is time to re-run the sync by hand.
    if (failedMembers.length > 0) {
        await sendCriticalAlert(
            `sync finished with ${failedMembers.length}/${memberCount} members incomplete`,
            `The weekly sync finished, but these members' data in staging is incomplete:\n\n` +
            failedMembers.map((u) => `  ${u}`).join('\n') + `\n\n` +
            (outageWaitMs > 0
                ? `The sync spent ${Math.round(outageWaitMs / 60000)}m waiting for Letterboxd to come back and still\n` +
                  `could not finish, so the outage outlasted its wait budget.\n\n`
                : `Letterboxd stayed reachable throughout, so this looks member-specific rather\n` +
                  `than an outage — a deleted, renamed or private account would do this.\n\n`) +
            `The promote is gated on this and will hold the week rather than publish partial\n` +
            `rankings. It re-checks hourly, so fixing the underlying problem and re-running\n` +
            `\`npm run sync\` is enough — the promote picks it up on its own.`,
        );
    }
}

main()
    .then(() => pool.end())
    .catch(async (err) => {
        console.error('[sync] fatal:', err);
        await sendCriticalAlert(
            'weekly sync CRASHED',
            `The weekly sync threw and did not finish, so staging is half-populated. The\n` +
            `promote is gated on staging being complete and will hold the week rather than\n` +
            `publish it. Re-run \`npm run sync\` on the VPS; the hourly promote check picks\n` +
            `it up once staging is good.\n\n${err?.stack || err}`,
        );
        pool.end().finally(() => process.exit(1));
    });
