import pool from '../db/conn.js';
import type { Request, Response } from 'express';
import type { GenreFilters, RankingFilters } from '../types/api.js';

const MAX_LIMIT = 500;
type SqlParam = string | number | string[] | boolean;

// Network identifier — 'metro' is the default community (all metrodb follows);
// 'lank' is the lycandb subset. Stored in users.is_metro/is_lycan and used as
// a discriminator on film_rankings_history.network and user_similarity_scores.
export type Network = 'metro' | 'lank';

interface NetworkSpec {
    userFlag: 'is_metro' | 'is_lycan';
    defaultMinRatings: number;
}

const NETWORKS: Record<Network, NetworkSpec> = {
    metro: { userFlag: 'is_metro', defaultMinRatings: 10 },
    lank:  { userFlag: 'is_lycan', defaultMinRatings: 5 },
};

function clampLimit(raw: unknown, defaultValue: number): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return defaultValue;
    return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseRankingFilters(raw: unknown): RankingFilters {
    return JSON.parse((raw || '{}') as string) as RankingFilters;
}

function genreEntries(genres: unknown): [string, string][] {
    return Object.entries((genres || {}) as Record<string, string>);
}

// Top film rankings for a given network. The user JOIN filters the ratings
// pool to that network's members; the rest is the same query for both.
async function _getFilmRankings(req: Request, res: Response, network: Network) {
    try {
        const spec = NETWORKS[network];
        const filters = parseRankingFilters(req.query.filters);

        const {
            page = 1,
            minYear,
            maxYear,
            minRatings = spec.defaultMinRatings,
            maxRatings,
            limit: rawLimit,
            genres = {}
        } = { ...filters, ...req.query } as RankingFilters;

        const limit = clampLimit(rawLimit, 100);
        const offset = (Number(page) - 1) * limit;
        const queryParams: SqlParam[] = [];
        let paramIndex = 1;

        let query = `
            SELECT
                total_count,
                ROW_NUMBER() OVER (ORDER BY (average_rating) DESC, (rating_count) DESC) AS ranking,
                title,
                year,
                slug,
                genres,
                average_rating,
                rating_count
            FROM (
                SELECT
                    f.title,
                    f.year,
                    f.slug,
                    f.genres,
                    AVG(r.rating) AS average_rating,
                    COUNT(r.rating) AS rating_count,
                    COUNT(*) OVER() AS total_count
                FROM
                    films f
                JOIN
                    ratings r ON f.film_id = r.film_id
                JOIN
                    users u ON r.user_id = u.user_id AND u.${spec.userFlag}
                WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
        `;

        const conditions: string[] = [];

        if (minYear) {
            conditions.push(`f.year >= $${paramIndex++}`);
            queryParams.push(minYear);
        }
        if (maxYear) {
            conditions.push(`f.year <= $${paramIndex++}`);
            queryParams.push(maxYear);
        }

        const includeGenres: string[] = [];
        const excludeGenres: string[] = [];
        genreEntries(genres).forEach(([genre, mode]) => {
            if (mode === 'include') includeGenres.push(genre);
            else if (mode === 'exclude') excludeGenres.push(genre);
        });

        if (includeGenres.length > 0) {
            conditions.push(`f.genres @> $${paramIndex++}::text[]`);
            queryParams.push(includeGenres);
        }
        if (excludeGenres.length > 0) {
            conditions.push(`NOT (f.genres && $${paramIndex++}::text[])`);
            queryParams.push(excludeGenres);
        }

        if (conditions.length > 0) query += ` AND ${conditions.join(' AND ')} `;

        query += `
                GROUP BY f.film_id, f.title, f.year, f.slug, f.genres
        `;

        const havingConditions: string[] = [];
        if (minRatings) {
            havingConditions.push(`COUNT(r.rating) >= $${paramIndex++}`);
            queryParams.push(minRatings);
        }
        if (maxRatings) {
            havingConditions.push(`COUNT(r.rating) <= $${paramIndex++}`);
            queryParams.push(maxRatings);
        }

        if (havingConditions.length > 0) query += ` HAVING ${havingConditions.join(' AND ')} `;

        query += `
            ) subquery
            ORDER BY average_rating DESC, rating_count DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        queryParams.push(limit, offset);

        const { rows } = await pool.query(query, queryParams);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} film rankings:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmRankings     = (req: Request, res: Response) => _getFilmRankings(req, res, 'metro');
export const getLankFilmRankings = (req: Request, res: Response) => _getFilmRankings(req, res, 'lank');

// Bottom-ranked films (metro-only — no lank counterpart).
export const getEvilMankFilmRankings = async (req: Request, res: Response) => {
    try {
        const filters = parseRankingFilters(req.query.filters);

        const {
            page = 1,
            minYear,
            maxYear,
            minRatings = 10,
            maxRatings,
            limit: rawLimit,
            genres = {}
        } = { ...filters, ...req.query } as RankingFilters;

        const limit = clampLimit(rawLimit, 100);
        const offset = (Number(page) - 1) * limit;
        const queryParams: SqlParam[] = [];
        let paramIndex = 1;

        let query = `
            SELECT
                total_count,
                ROW_NUMBER() OVER (ORDER BY (average_rating) ASC, (rating_count) DESC) AS ranking,
                title, year, slug, genres, average_rating, rating_count
            FROM (
                SELECT
                    f.title, f.year, f.slug, f.genres,
                    AVG(r.rating) AS average_rating,
                    COUNT(r.rating) AS rating_count,
                    COUNT(*) OVER() AS total_count
                FROM films f
                JOIN ratings r ON f.film_id = r.film_id
                JOIN users   u ON r.user_id = u.user_id AND u.is_metro
                WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
        `;

        const conditions: string[] = [];
        if (minYear) { conditions.push(`f.year >= $${paramIndex++}`); queryParams.push(minYear); }
        if (maxYear) { conditions.push(`f.year <= $${paramIndex++}`); queryParams.push(maxYear); }

        const includeGenres: string[] = [];
        const excludeGenres: string[] = [];
        genreEntries(genres).forEach(([genre, mode]) => {
            if (mode === 'include') includeGenres.push(genre);
            else if (mode === 'exclude') excludeGenres.push(genre);
        });
        if (includeGenres.length > 0) {
            conditions.push(`f.genres @> $${paramIndex++}::text[]`);
            queryParams.push(includeGenres);
        }
        if (excludeGenres.length > 0) {
            conditions.push(`NOT (f.genres && $${paramIndex++}::text[])`);
            queryParams.push(excludeGenres);
        }
        if (conditions.length > 0) query += ` AND ${conditions.join(' AND ')} `;

        query += ` GROUP BY f.film_id, f.title, f.year, f.slug, f.genres `;

        const havingConditions: string[] = [];
        if (minRatings) { havingConditions.push(`COUNT(r.rating) >= $${paramIndex++}`); queryParams.push(minRatings); }
        if (maxRatings) { havingConditions.push(`COUNT(r.rating) <= $${paramIndex++}`); queryParams.push(maxRatings); }
        if (havingConditions.length > 0) query += ` HAVING ${havingConditions.join(' AND ')} `;

        query += `
            ) subquery
            ORDER BY average_rating ASC, rating_count DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        queryParams.push(limit, offset);

        const { rows } = await pool.query(query, queryParams);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching bottom film rankings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Risers / fallers / new-entries / new-departures all read from
// film_rankings_history. Network discriminator is passed as $1.
async function _getFilmRisersRankings(_req: Request, res: Response, network: Network) {
    try {
        const query = `
            SELECT
                frh.title, frh.year, frh.slug,
                frh.current_rank, frh.previous_rank,
                (frh.previous_rank - frh.current_rank) AS rank_change
            FROM (
                SELECT
                    f.film_id, f.title, f.year, f.slug,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $1)
                    ) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history WHERE network = $1)
                    ) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
              AND frh.current_rank IS NOT NULL
              AND frh.previous_rank > frh.current_rank
            ORDER BY rank_change DESC
            LIMIT 100
        `;
        const { rows } = await pool.query(query, [network]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} risers' rankings:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmRisersRankings     = (req: Request, res: Response) => _getFilmRisersRankings(req, res, 'metro');
export const getLankFilmRisersRankings = (req: Request, res: Response) => _getFilmRisersRankings(req, res, 'lank');

async function _getFilmFallersRankings(_req: Request, res: Response, network: Network) {
    try {
        const query = `
            SELECT
                frh.title, frh.year, frh.slug,
                frh.current_rank, frh.previous_rank,
                (frh.previous_rank - frh.current_rank) AS rank_change
            FROM (
                SELECT
                    f.film_id, f.title, f.year, f.slug,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $1)
                    ) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history WHERE network = $1)
                    ) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
              AND frh.current_rank IS NOT NULL
              AND frh.previous_rank < frh.current_rank
            ORDER BY rank_change ASC
            LIMIT 100
        `;
        const { rows } = await pool.query(query, [network]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} fallers' rankings:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmFallersRankings     = (req: Request, res: Response) => _getFilmFallersRankings(req, res, 'metro');
export const getLankFilmFallersRankings = (req: Request, res: Response) => _getFilmFallersRankings(req, res, 'lank');

async function _getFilmNewEntriesRankings(_req: Request, res: Response, network: Network) {
    try {
        const query = `
            SELECT frh.title, frh.year, frh.slug, frh.current_rank
            FROM (
                SELECT
                    f.film_id, f.title, f.year, f.slug,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $1)
                    ) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history WHERE network = $1)
                    ) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NULL
              AND frh.current_rank IS NOT NULL
            ORDER BY frh.current_rank ASC
            LIMIT 100
        `;
        const { rows } = await pool.query(query, [network]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} new-entries' rankings:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmNewEntriesRankings     = (req: Request, res: Response) => _getFilmNewEntriesRankings(req, res, 'metro');
export const getLankFilmNewEntriesRankings = (req: Request, res: Response) => _getFilmNewEntriesRankings(req, res, 'lank');

async function _getFilmNewDeparturesRankings(_req: Request, res: Response, network: Network) {
    try {
        const query = `
            SELECT frh.title, frh.year, frh.slug, frh.previous_rank
            FROM (
                SELECT
                    f.film_id, f.title, f.year, f.slug,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $1)
                    ) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh
                       WHERE f.film_id = frh.film_id AND frh.network = $1
                         AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history WHERE network = $1)
                    ) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
              AND frh.current_rank IS NULL
            ORDER BY frh.previous_rank ASC
            LIMIT 100
        `;
        const { rows } = await pool.query(query, [network]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} new-departures' rankings:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmNewDeparturesRankings     = (req: Request, res: Response) => _getFilmNewDeparturesRankings(req, res, 'metro');
export const getLankFilmNewDeparturesRankings = (req: Request, res: Response) => _getFilmNewDeparturesRankings(req, res, 'lank');

// Film details — same shape both networks. Ratings + average + current_rank
// filter to the network's members & history rows.
async function _getFilmDetails(req: Request<{ slug: string }>, res: Response, network: Network) {
    const { slug } = req.params;
    const spec = NETWORKS[network];
    try {
        const filmQuery = `
            SELECT
                f.title, f.year, f.directors, f.genres, f.countries, f.languages,
                f.runtime, f.synopsis,
                AVG(r.rating) AS average_rating,
                COUNT(r.rating) AS rating_count,
                (
                    SELECT ranking FROM film_rankings_history frh
                    WHERE f.film_id = frh.film_id AND frh.network = $2
                      AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $2)
                ) AS current_rank,
                (
                    SELECT ranking FROM film_rankings_history frh
                    WHERE f.film_id = frh.film_id AND frh.network = $2
                      AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history WHERE network = $2)
                ) AS previous_rank
            FROM films f
            JOIN ratings r ON f.film_id = r.film_id
            JOIN users   u ON r.user_id = u.user_id AND u.${spec.userFlag}
            WHERE f.slug = $1
            GROUP BY f.film_id, f.title, f.year, f.slug, f.synopsis
        `;
        const filmResult = await pool.query(filmQuery, [slug, network]);
        const film = filmResult.rows[0];

        if (!film) {
            return res.status(404).json({ error: 'Film not found' });
        }

        const ratingsQuery = `
            SELECT u.username, u.display_name, r.rating
            FROM ratings r
            JOIN users u ON r.user_id = u.user_id AND u.${spec.userFlag}
            JOIN films f ON r.film_id = f.film_id
            WHERE f.slug = $1
            ORDER BY r.rating DESC
        `;
        const ratingsResult = await pool.query(ratingsQuery, [slug]);

        res.json({ film, ratings: ratingsResult.rows });
    } catch (error) {
        if (Number(error.code) === 404) throw error;
        console.error(`Error fetching ${network} film details:`, error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getFilmDetails     = (req: Request<{ slug: string }>, res: Response) => _getFilmDetails(req, res, 'metro');
export const getLankFilmDetails = (req: Request<{ slug: string }>, res: Response) => _getFilmDetails(req, res, 'lank');

// Members list. Filters users by network membership.
async function _getMembers(req: Request, res: Response, network: Network) {
    try {
        const spec = NETWORKS[network];
        const {
            page = 1,
            limit: rawLimit,
            sort = 'Watched',
        } = { ...req.query };

        const limit = clampLimit(rawLimit, 25);
        const offset = (Number(page) - 1) * limit;

        const orderBy = sort === 'Name' ? 'UPPER(display_name) ASC' : 'num_films_watched DESC';
        const query = `
            SELECT
                COUNT(*) OVER() AS total_count,
                user_id, username, display_name, num_films_watched
            FROM users
            WHERE ${spec.userFlag}
            ORDER BY ${orderBy}
            LIMIT $1 OFFSET $2
        `;
        const { rows } = await pool.query(query, [limit, offset]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} members:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getMembers     = (req: Request, res: Response) => _getMembers(req, res, 'metro');
export const getLankMembers = (req: Request, res: Response) => _getLankMembersImpl(req, res);
async function _getLankMembersImpl(req: Request, res: Response) { return _getMembers(req, res, 'lank'); }

// Single member's details. The member's avg_rating is their own — same value
// regardless of network — but we still gate the lookup by network membership
// so /lank/members/:not-a-lycan returns 404.
async function _getMemberDetails(req: Request<{ username: string }>, res: Response, network: Network) {
    try {
        const spec = NETWORKS[network];
        const { username } = req.params;
        const query = `
            SELECT
                u.user_id, u.username, u.display_name, u.num_films_watched,
                AVG(r.rating) AS avg_rating
            FROM users u
            LEFT JOIN ratings r ON r.user_id = u.user_id
            WHERE u.username = $1 AND u.${spec.userFlag}
            GROUP BY u.user_id
        `;
        const memberResult = await pool.query(query, [username]);
        const member = memberResult.rows[0];
        if (!member) return res.status(404).json({ error: 'Member not found' });
        res.json(member);
    } catch (error) {
        console.error(`Error fetching ${network} member details:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getMemberDetails     = (req: Request<{ username: string }>, res: Response) => _getMemberDetails(req, res, 'metro');
export const getLankMemberDetails = (req: Request<{ username: string }>, res: Response) => _getMemberDetails(req, res, 'lank');

// Neighbors — uses user_similarity_scores filtered to the network.
async function _getMemberNeighbors(req: Request<{ username: string }>, res: Response, network: Network) {
    try {
        const { username } = req.params;
        const {
            page = 1,
            limit: rawLimit,
            sort = 'Similarity Score',
        } = { ...req.query };

        const limit = clampLimit(rawLimit, 25);
        const offset = (Number(page) - 1) * limit;
        const orderBy = sort === 'Name' ? 'UPPER(ub.display_name) ASC' : 'usc.similarity_score DESC';
        const query = `
            SELECT
                COUNT(*) OVER() AS total_count,
                ua.username AS user_a,
                ub.username AS neighbor_username,
                ub.display_name AS neighbor_display_name,
                usc.similarity_score AS similarity_score,
                usc.overlap_count,
                usc.avg_rating_distance
            FROM user_similarity_scores usc
            JOIN users ua ON usc.user_a = ua.user_id
            JOIN users ub ON usc.user_b = ub.user_id
            WHERE ua.username = $1 AND usc.network = $2
            ORDER BY ${orderBy}
            LIMIT $3 OFFSET $4
        `;
        const { rows } = await pool.query(query, [username, network, limit, offset]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} member neighbors:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getMemberNeighbors     = (req: Request<{ username: string }>, res: Response) => _getMemberNeighbors(req, res, 'metro');
export const getLankMemberNeighbors = (req: Request<{ username: string }>, res: Response) => _getMemberNeighbors(req, res, 'lank');

async function _getNeighborDetails(req: Request<{ username_a: string; username_b: string }>, res: Response, network: Network) {
    try {
        const { username_a, username_b } = req.params;
        const query = `
            SELECT
                ua.username AS user_a,
                ub.username AS neighbor_username,
                ub.display_name AS neighbor_display_name,
                usc.similarity_score AS similarity_score,
                usc.overlap_count,
                usc.avg_rating_distance
            FROM user_similarity_scores usc
            JOIN users ua ON usc.user_a = ua.user_id
            JOIN users ub ON usc.user_b = ub.user_id
            WHERE ua.username = $1 AND ub.username = $2 AND usc.network = $3
        `;
        const result = await pool.query(query, [username_a, username_b, network]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error(`Error fetching ${network} neighbor details:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getNeighborDetails     = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborDetails(req, res, 'metro');
export const getLankNeighborDetails = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborDetails(req, res, 'lank');

// Agreed / Differ films: these are between two specific users — the ratings
// shown are their actual ratings, so no network filter needed at the rating
// level. But for /lank context we still want to 404 if either user isn't in
// the lycan pool, so we add a sanity check on user network membership.
async function _getNeighborAgreedFilms(req: Request<{ username_a: string; username_b: string }>, res: Response, network: Network) {
    try {
        const spec = NETWORKS[network];
        const { username_a, username_b } = req.params;
        const { page = 1, limit: rawLimit } = { ...req.query };
        const limit = clampLimit(rawLimit, 20);
        const offset = (Number(page) - 1) * limit;

        const query = `
            SELECT
                COUNT(*) OVER() AS total_count,
                f.slug, f.title, f.year,
                ua.username AS user_a_username,
                ra.rating AS user_a_rating,
                ub.username AS user_b_username,
                rb.rating AS user_b_rating
            FROM ratings ra
            JOIN films   f  ON ra.film_id = f.film_id
            JOIN ratings rb ON ra.film_id = rb.film_id AND ra.user_id != rb.user_id
            JOIN users   ua ON ra.user_id = ua.user_id AND ua.${spec.userFlag}
            JOIN users   ub ON rb.user_id = ub.user_id AND ub.${spec.userFlag}
            WHERE ua.username = $1 AND ub.username = $2 AND ra.rating = rb.rating
            ORDER BY f.year, f.title
            LIMIT $3 OFFSET $4
        `;
        const { rows } = await pool.query(query, [username_a, username_b, limit, offset]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} neighbor agreed films:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getNeighborAgreedFilms     = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborAgreedFilms(req, res, 'metro');
export const getLankNeighborAgreedFilms = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborAgreedFilms(req, res, 'lank');

async function _getNeighborDifferFilms(req: Request<{ username_a: string; username_b: string }>, res: Response, network: Network) {
    try {
        const spec = NETWORKS[network];
        const { username_a, username_b } = req.params;
        const { page = 1, limit: rawLimit } = { ...req.query };
        const limit = clampLimit(rawLimit, 20);
        const offset = (Number(page) - 1) * limit;

        const query = `
            SELECT
                COUNT(*) OVER() AS total_count,
                f.slug, f.title, f.year,
                ua.username AS user_a_username,
                ra.rating AS user_a_rating,
                ub.username AS user_b_username,
                rb.rating AS user_b_rating
            FROM ratings ra
            JOIN films   f  ON ra.film_id = f.film_id
            JOIN ratings rb ON ra.film_id = rb.film_id AND ra.user_id != rb.user_id
            JOIN users   ua ON ra.user_id = ua.user_id AND ua.${spec.userFlag}
            JOIN users   ub ON rb.user_id = ub.user_id AND ub.${spec.userFlag}
            WHERE ua.username = $1 AND ub.username = $2 AND ra.rating != rb.rating
            ORDER BY ABS(ra.rating - rb.rating) ASC, f.year, f.title
            LIMIT $3 OFFSET $4
        `;
        const { rows } = await pool.query(query, [username_a, username_b, limit, offset]);
        res.json(rows);
    } catch (error) {
        console.error(`Error fetching ${network} neighbor differ films:`, error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

export const getNeighborDifferFilms     = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborDifferFilms(req, res, 'metro');
export const getLankNeighborDifferFilms = (req: Request<{ username_a: string; username_b: string }>, res: Response) => _getNeighborDifferFilms(req, res, 'lank');
