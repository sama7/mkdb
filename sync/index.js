import 'dotenv/config';
import pool from '../db/conn.js';
import { discoverMembers } from './discover-members.js';
import { syncAllRatings } from './sync-ratings.js';
import { syncNewFilms } from './sync-films.js';
import { runPromote } from '../scripts/promote.js';

// Orchestrator order matters:
// 0. Truncate staging tables so each run starts clean.
// 1. Enumerate the metrodb-following community into users_stg.
// 2. Pull every member's ratings into ratings_stg, stubbing new films into `films`.
// 3. Sync film details + posters for all new films (details_fetched_at IS NULL).
//    Must happen before promote so the live site never shows films with missing details.
// 4. Promote: swap staging into live, recompute similarity, append the new ranking
//    week, trim history to 3 weeks, delete orphan films + their posters.

function formatDuration(ms) {
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
    console.log(`[sync] start at ${new Date().toISOString()}`);

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

    const tPromote = Date.now();
    const promoteResult = await runPromote();
    console.log(`[sync] promote done: orphans=${promoteResult.orphanCount}, posters_removed=${promoteResult.postersRemoved} in ${formatDuration(Date.now() - tPromote)}`);

    console.log(`[sync] done in ${formatDuration(Date.now() - t0)}`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[sync] fatal:', err);
        pool.end().finally(() => process.exit(1));
    });
