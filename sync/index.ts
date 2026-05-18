import 'dotenv/config';
import pool from '../db/conn.js';
import { discoverMembers } from './discover-members.js';
import { syncAllRatings } from './sync-ratings.js';
import { syncNewFilms } from './sync-films.js';

// Orchestrator order matters:
// 0. Truncate staging tables so each run starts clean.
// 1. Enumerate the metrodb-following community into users_stg.
// 2. Pull every member's ratings into ratings_stg, stubbing new films into `films`.
// 3. Sync film details + posters for all new films (details_fetched_at IS NULL).
//
// Promote (swap staging → live, recompute similarity, append the new ranking
// week, trim history to 3 weeks, delete orphan films + their posters) is run
// SEPARATELY via `npm run promote`. The two stages are scheduled by cron at
// different times (sync Sunday 23:00 ET, promote Monday 00:00 ET) so they
// can be timed and monitored independently.

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
    const memberCount = await discoverMembers();
    console.log(`[sync] discovered ${memberCount} members in ${formatDuration(Date.now() - tDiscover)}`);

    const tRatings = Date.now();
    const { totalIngested } = await syncAllRatings();
    console.log(`[sync] ratings ingested: ${totalIngested} in ${formatDuration(Date.now() - tRatings)}`);

    const tFilms = Date.now();
    const filmsResult = await syncNewFilms();
    console.log(`[sync] film details: ok=${filmsResult.ok}, failed=${filmsResult.failed}, total=${filmsResult.total} in ${formatDuration(Date.now() - tFilms)}`);

    console.log(`[sync] done in ${formatDuration(Date.now() - t0)} (staging populated; run \`npm run promote\` to swap into live)`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[sync] fatal:', err);
        pool.end().finally(() => process.exit(1));
    });
