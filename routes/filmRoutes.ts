import * as express from 'express';
import * as filmController from '../controllers/filmController.js';

const router = express.Router();

// =============================================================================
// Metro (default community) routes
// =============================================================================

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

// GET /api/members - Retrieve community members with pagination
router.get('/members', filmController.getMembers);

// GET /api/members/:username - Retrieve a specific community member's details
router.get('/members/:username', filmController.getMemberDetails);

// GET /api/member/:username - Retrieve a specific community member's details
router.get('/member/:username', filmController.getMemberNeighbors);

// GET /api/neighbors/:username_a/:username_b - Retrieve neighbor details between two community members
router.get('/neighbors/:username_a/:username_b', filmController.getNeighborDetails);

// GET /api/neighbors-agreed/:username_a/:username_b - Retrieve films whose rating the two neighbors agreed on
router.get('/neighbors-agreed/:username_a/:username_b', filmController.getNeighborAgreedFilms);

// GET /api/neighbors-differ/:username_a/:username_b - Retrieve films whose rating the two neighbors differed on
router.get('/neighbors-differ/:username_a/:username_b', filmController.getNeighborDifferFilms);

// GET /api/evil-mank - Bottom-ranked films (metro-only)
router.get('/evil-mank', filmController.getEvilMankFilmRankings);

// GET /api/filter-options - distinct genres/countries/languages for the filter UI
router.get('/filter-options', filmController.getFilterOptions);

// GET /api/directors/search?query=… - type-ahead for the director filter (~29k distinct)
router.get('/directors/search', filmController.searchDirectors);

// =============================================================================
// Lank (lycandb subset) routes — same shape as the metro routes above, but
// the underlying queries filter to users.is_lycan and film_rankings_history /
// user_similarity_scores rows with network='lank'.
// =============================================================================

router.get('/lank',                                       filmController.getLankFilmRankings);
router.get('/lank/film/:slug',                            filmController.getLankFilmDetails);
router.get('/lank/risers',                                filmController.getLankFilmRisersRankings);
router.get('/lank/fallers',                               filmController.getLankFilmFallersRankings);
router.get('/lank/new-entries',                           filmController.getLankFilmNewEntriesRankings);
router.get('/lank/new-departures',                        filmController.getLankFilmNewDeparturesRankings);
router.get('/lank/members',                               filmController.getLankMembers);
router.get('/lank/members/:username',                     filmController.getLankMemberDetails);
router.get('/lank/member/:username',                      filmController.getLankMemberNeighbors);
router.get('/lank/neighbors/:username_a/:username_b',        filmController.getLankNeighborDetails);
router.get('/lank/neighbors-agreed/:username_a/:username_b', filmController.getLankNeighborAgreedFilms);
router.get('/lank/neighbors-differ/:username_a/:username_b', filmController.getLankNeighborDifferFilms);

export default router;
