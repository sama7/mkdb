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

// GET /api/discord/posters-grid?slugs=a,b,... - Composite poster grid for embeds
router.get('/posters-grid', discordController.getPostersGrid);

// The `/mkdb top` bot command reuses the site's ranking query verbatim, so it
// supports exactly the same filters as the web UI. Exposed under /api/discord
// so the bot keeps talking to a single base URL (MKDB_API_BASE_URL).
// GET /api/discord/top?limit=&filters={…}
router.get('/top', filmController.getFilmRankings);

// Sources for the bot's filter autocomplete.
// GET /api/discord/filter-options       - distinct genres / countries / languages
// GET /api/discord/directors/search?query=… - director type-ahead
router.get('/filter-options', filmController.getFilterOptions);
router.get('/directors/search', filmController.searchDirectors);

export default router;