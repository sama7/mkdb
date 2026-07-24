import * as express from 'express';
import * as discordController from '../controllers/discordController.js';
import * as filmController from '../controllers/filmController.js';

const router = express.Router();

// GET /api/discord/films/search - Retrieve film details by search query
router.get('/films/search', discordController.searchFilm);

// GET /api/discord/films/rank/:rank - Retrieve film details by rank
router.get('/films/rank/:rank', discordController.getFilmByRank);

// GET /api/discord/films/nearmank/:rank - Retrieve film details by near-mank rank (7-9 ratings, top 100)
router.get('/films/nearmank/:rank', discordController.getNearMankFilmByRank);

// GET /api/discord/films/ratings - Retrieve film details and ratings by search query
router.get('/films/ratings', discordController.searchFilmRatings);

// GET /api/discord/films/by-contributor - Films by director or actor (matched against MKDb)
router.get('/films/by-contributor', discordController.filmsByContributor);

// The `/mkdb top` bot command reuses the site's ranking query verbatim, so it
// supports exactly the same filters as the web UI. Exposed under /api/discord
// so the bot keeps talking to a single base URL (MKDB_API_BASE_URL).
// GET /api/discord/top?limit=&filters={…}
router.get('/top', filmController.getFilmRankings);

/* ---------------------------------------------------------------------------
   Lycan network. Same endpoints, ranked against the lycandb membership, under
   a /lank prefix that mirrors the site's own (mkdb.co/lank). The Lycan bot
   points MKDB_API_BASE_URL here and is otherwise identical to the Metro one.
--------------------------------------------------------------------------- */
const lank = express.Router();
lank.get('/films/search', discordController.getLankSearchFilm);
lank.get('/films/rank/:rank', discordController.getLankFilmByRank);
lank.get('/films/nearmank/:rank', discordController.getLankNearMankFilmByRank);
lank.get('/films/ratings', discordController.getLankSearchFilmRatings);
lank.get('/films/by-contributor', discordController.getLankFilmsByContributor);
lank.get('/top', filmController.getLankFilmRankings);

// Posters and the filter vocabularies come from the shared `films` table, so
// both networks read the same handlers.
for (const r of [router, lank]) {
    // GET …/posters-grid?slugs=a,b,…&labels=1,2,… - Composite poster grid for embeds
    r.get('/posters-grid', discordController.getPostersGrid);
    // GET …/filter-options       - distinct genres / countries / languages
    // GET …/directors/search?query=… - director type-ahead
    r.get('/filter-options', filmController.getFilterOptions);
    r.get('/directors/search', filmController.searchDirectors);
}

router.use('/lank', lank);

export default router;
