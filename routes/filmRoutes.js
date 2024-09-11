import express from 'express';
import * as filmController from '../controllers/filmController.js';

const router = express.Router();

// GET /api/rankings - Retrieve film rankings with optional filters
router.get('/rankings', filmController.getFilmRankings);

// GET /api/film/:slug - Retrieve synopsis and ratings details for an individual film
router.get('/film/:slug', filmController.getFilmDetails);


export default router;