import * as express from 'express';
import * as discordController from '../controllers/discordController.js';

const router = express.Router();

// GET /api/discord/films/search - Retrieve film details by search query
router.get('/films/search', discordController.validateSearchQuery, discordController.searchFilm);

// GET /api/discord/films/rank/:rank - Retrieve film details by rank
router.get('/films/rank/:rank', discordController.getFilmByRank);

// GET /api/discord/films/nearmank/:rank - Retrieve film details by near-mank rank (7-9 ratings, top 50)
router.get('/films/nearmank/:rank', discordController.getNearMankFilmByRank);

// GET /api/discord/films/ratings - Retrieve film details and ratings by search query
router.get('/films/ratings', discordController.validateSearchQuery, discordController.searchFilmRatings);

export default router;