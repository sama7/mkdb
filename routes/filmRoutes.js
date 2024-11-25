import * as express from 'express';
import * as filmController from '../controllers/filmController.js';

const router = express.Router();

// GET /api/rankings - Retrieve top film rankings with optional filters
router.get('/rankings', filmController.getFilmRankings);

// GET /api/film/:slug - Retrieve synopsis and ratings details for an individual film
router.get('/film/:slug', filmController.getFilmDetails);

// GET /api/risers - Retrieve film risers' rankings
router.get('/risers', filmController.getFilmRisersRankings);

// GET /api/fallers - Retrieve film fallers' rankings
router.get('/fallers', filmController.getFilmFallersRankings);

// GET /api/new-entries - Retrieve film new entries' rankings
router.get('/new-entries', filmController.getFilmNewEntriesRankings);

// GET /api/new-departures - Retrieve film new departures' rankings
router.get('/new-departures', filmController.getFilmNewDeparturesRankings);

// GET /api/evil-mank - Retrieve top film rankings with optional filters
router.get('/evil-mank', filmController.getEvilMankFilmRankings);

export default router;