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

async function main() {
    const t0 = Date.now();
    console.log('[sync] start');

    await pool.query('TRUNCATE TABLE ratings_stg; TRUNCATE TABLE users_stg CASCADE;');
    console.log('[sync] staging tables cleared');

    const memberCount = await discoverMembers();
    console.log(`[sync] discovered ${memberCount} members`);

    const { totalIngested } = await syncAllRatings();
    console.log(`[sync] ratings ingested: ${totalIngested}`);

    const filmsResult = await syncNewFilms();
    console.log(`[sync] film details: ok=${filmsResult.ok}, failed=${filmsResult.failed}, total=${filmsResult.total}`);

    const promoteResult = await runPromote();
    console.log(`[sync] promote done: orphans=${promoteResult.orphanCount}, posters_removed=${promoteResult.postersRemoved}`);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[sync] done in ${elapsed}s`);
}

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[sync] fatal:', err);
        pool.end().finally(() => process.exit(1));
    });
