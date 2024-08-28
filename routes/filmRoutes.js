import express from 'express';
import { getFilmRankings } from '../controllers/filmController.js';

const router = express.Router();

// GET /api/films/rankings - Retrieve film rankings with optional filters
router.get('/rankings', getFilmRankings);

export default router;