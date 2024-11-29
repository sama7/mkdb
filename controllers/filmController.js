import pool from '../db/conn.js';

// Function to get top film rankings with optional filters
export const getFilmRankings = async (req, res) => {
    try {
        // Parse the filters from the query string
        const filters = JSON.parse(req.query.filters || '{}');

        // Extract page and filters
        const {
            page = 1,
            minYear,
            maxYear,
            minRatings = 10,  // Default value
            maxRatings,
            limit = 100,       // same as filmsPerPage
            genres = {}
        } = { ...filters, ...req.query };

        const offset = (page - 1) * limit;  // for pagination
        const queryParams = [];
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
                WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
        `;

        const conditions = [];

        // Add optional minYear and maxYear filters
        if (minYear) {
            conditions.push(`f.year >= $${paramIndex++}`);
            queryParams.push(minYear);
        }
        if (maxYear) {
            conditions.push(`f.year <= $${paramIndex++}`);
            queryParams.push(maxYear);
        }

        // Handle genres filter: include or exclude genres
        const includeGenres = [];
        const excludeGenres = [];

        Object.keys(genres).forEach((genre) => {
            if (genres[genre] === 'include') {
                includeGenres.push(genre);
            } else if (genres[genre] === 'exclude') {
                excludeGenres.push(genre);
            }
        });

        // Add conditions for included genres - film must include *all* genres in the list
        if (includeGenres.length > 0) {
            conditions.push(`f.genres @> $${paramIndex++}::text[]`);
            queryParams.push(includeGenres);
        }

        // Add conditions for excluded genres - exclude films that have any of the listed genres
        if (excludeGenres.length > 0) {
            conditions.push(`NOT (f.genres && $${paramIndex++}::text[])`);
            queryParams.push(excludeGenres);
        }

        // Append any additional conditions for year if they exist
        if (conditions.length > 0) {
            query += ` AND ${conditions.join(' AND ')} `;
        }

        query += `
                GROUP BY
                    f.film_id, f.title, f.year, f.slug, f.genres
        `;

        const havingConditions = [];

        if (minRatings) {
            havingConditions.push(`COUNT(r.rating) >= $${paramIndex++}`);
            queryParams.push(minRatings);
        }
        if (maxRatings) {
            havingConditions.push(`COUNT(r.rating) <= $${paramIndex++}`);
            queryParams.push(maxRatings);
        }

        if (havingConditions.length > 0) {
            query += ` HAVING ${havingConditions.join(' AND ')} `;
        }

        query += `
            ) subquery    
            ORDER BY average_rating DESC, rating_count DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;

        queryParams.push(limit, offset);

        console.log(`query: ${query}`);
        console.log(`queryParams: ${queryParams}`);

        const { rows } = await pool.query(query, queryParams);
        console.log(`Query returned ${rows.length} rows.`);
        if (rows.length > 0) {
            console.log(`total_count: ${rows[0].total_count}`);
        }
        res.json(rows);
    } catch (error) {
        console.error('Error fetching top film rankings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get bottom film rankings with optional filters
export const getEvilMankFilmRankings = async (req, res) => {
    try {
        // Parse the filters from the query string
        const filters = JSON.parse(req.query.filters || '{}');

        // Extract page and filters
        const {
            page = 1,
            minYear,
            maxYear,
            minRatings = 10,  // Default value
            maxRatings,
            limit = 100,       // same as filmsPerPage
            genres = {}
        } = { ...filters, ...req.query };

        const offset = (page - 1) * limit;  // for pagination
        const queryParams = [];
        let paramIndex = 1;

        let query = `
            SELECT
                total_count,
                ROW_NUMBER() OVER (ORDER BY (average_rating) ASC, (rating_count) DESC) AS ranking,
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
                WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
        `;

        const conditions = [];

        // Add optional minYear and maxYear filters
        if (minYear) {
            conditions.push(`f.year >= $${paramIndex++}`);
            queryParams.push(minYear);
        }
        if (maxYear) {
            conditions.push(`f.year <= $${paramIndex++}`);
            queryParams.push(maxYear);
        }

        // Handle genres filter: include or exclude genres
        const includeGenres = [];
        const excludeGenres = [];

        Object.keys(genres).forEach((genre) => {
            if (genres[genre] === 'include') {
                includeGenres.push(genre);
            } else if (genres[genre] === 'exclude') {
                excludeGenres.push(genre);
            }
        });

        // Add conditions for included genres - film must include *all* genres in the list
        if (includeGenres.length > 0) {
            conditions.push(`f.genres @> $${paramIndex++}::text[]`);
            queryParams.push(includeGenres);
        }

        // Add conditions for excluded genres - exclude films that have any of the listed genres
        if (excludeGenres.length > 0) {
            conditions.push(`NOT (f.genres && $${paramIndex++}::text[])`);
            queryParams.push(excludeGenres);
        }

        // Append any additional conditions for year if they exist
        if (conditions.length > 0) {
            query += ` AND ${conditions.join(' AND ')} `;
        }

        query += `
                GROUP BY
                    f.film_id, f.title, f.year, f.slug, f.genres
        `;

        const havingConditions = [];

        if (minRatings) {
            havingConditions.push(`COUNT(r.rating) >= $${paramIndex++}`);
            queryParams.push(minRatings);
        }
        if (maxRatings) {
            havingConditions.push(`COUNT(r.rating) <= $${paramIndex++}`);
            queryParams.push(maxRatings);
        }

        if (havingConditions.length > 0) {
            query += ` HAVING ${havingConditions.join(' AND ')} `;
        }

        query += `
            ) subquery    
            ORDER BY average_rating ASC, rating_count DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;

        queryParams.push(limit, offset);

        console.log(`query: ${query}`);
        console.log(`queryParams: ${queryParams}`);

        const { rows } = await pool.query(query, queryParams);
        console.log(`Query returned ${rows.length} rows.`);
        if (rows.length > 0) {
            console.log(`total_count: ${rows[0].total_count}`);
        }
        res.json(rows);
    } catch (error) {
        console.error('Error fetching bottom film rankings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get greatest risers' rankings
export const getFilmRisersRankings = async (req, res) => {
    try {
        const query = `
            SELECT
                frh.title,
                frh.year,
                frh.slug,
                frh.current_rank,
                frh.previous_rank,
                (frh.previous_rank - frh.current_rank) AS rank_change
            FROM (
                SELECT
                    f.film_id,
                    f.title,
                    f.year,
                    f.slug,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) FROM film_rankings_history)) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history)) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
                AND frh.current_rank IS NOT NULL
                AND frh.previous_rank > frh.current_rank
            ORDER BY rank_change DESC
            LIMIT 100
        `;

        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching film risers' rankings:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get greatest fallers' rankings
export const getFilmFallersRankings = async (req, res) => {
    try {
        const query = `
            SELECT
                frh.title,
                frh.year,
                frh.slug,
                frh.current_rank,
                frh.previous_rank,
                (frh.previous_rank - frh.current_rank) AS rank_change
            FROM (
                SELECT
                    f.film_id,
                    f.title,
                    f.year,
                    f.slug,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) FROM film_rankings_history)) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history)) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
                AND frh.current_rank IS NOT NULL
                AND frh.previous_rank < frh.current_rank
            ORDER BY rank_change ASC
            LIMIT 100;  -- Adjust limit as needed
        `;

        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching film fallers' rankings:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get new entries' rankings
export const getFilmNewEntriesRankings = async (req, res) => {
    try {
        const query = `
            SELECT
                frh.title,
                frh.year,
                frh.slug,
                frh.current_rank
            FROM (
                SELECT
                    f.film_id,
                    f.title,
                    f.year,
                    f.slug,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) FROM film_rankings_history)) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history)) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NULL
                AND frh.current_rank IS NOT NULL
            ORDER BY frh.current_rank ASC
            LIMIT 100;  -- Adjust limit as needed
        `;

        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching film new entries' rankings:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get new departures' rankings
export const getFilmNewDeparturesRankings = async (req, res) => {
    try {
        const query = `
            SELECT
                frh.title,
                frh.year,
                frh.slug,
                frh.previous_rank
            FROM (
                SELECT
                    f.film_id,
                    f.title,
                    f.year,
                    f.slug,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) FROM film_rankings_history)) AS current_rank,
                    (SELECT ranking FROM film_rankings_history frh WHERE f.film_id = frh.film_id AND frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history)) AS previous_rank
                FROM films f
            ) AS frh
            WHERE frh.previous_rank IS NOT NULL
                AND frh.current_rank IS NULL
            ORDER BY frh.previous_rank ASC
            LIMIT 100;  -- Adjust limit as needed
        `;

        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error("Error fetching film new departures' rankings:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get film details and ratings
export const getFilmDetails = async (req, res) => {
    const { slug } = req.params;

    try {
        // Fetch film details
        const filmQuery = `
            SELECT
                f.title,
                f.year,
                f.synopsis,
                AVG(r.rating) AS average_rating,
                COUNT(r.rating) AS rating_count,
                (
                    SELECT ranking
                    FROM film_rankings_history frh
                    WHERE 
                        f.film_id = frh.film_id
                        AND
                        frh.week = (SELECT MAX(week) FROM film_rankings_history)
                ) AS current_rank,
                (
                    SELECT ranking
                    FROM film_rankings_history frh
                    WHERE 
                        f.film_id = frh.film_id
                        AND
                        frh.week = (SELECT MAX(week) - 1 FROM film_rankings_history)
                ) AS previous_rank
            FROM
                films f
            JOIN
                ratings r ON f.film_id = r.film_id
            WHERE f.slug = $1
            GROUP BY
                f.film_id, f.title, f.year, f.slug, f.synopsis 
        `;
        const filmResult = await pool.query(filmQuery, [slug]);
        const film = filmResult.rows[0];

        if (!film) {
            return res.status(404).json({ error: 'Film not found' });
        }

        // Fetch user ratings
        const ratingsQuery = `
            SELECT u.username, u.display_name, r.rating
            FROM ratings r
            JOIN users u ON r.user_id = u.user_id
            JOIN films f ON r.film_id = f.film_id
            WHERE f.slug = $1
            ORDER BY r.rating DESC
        `;
        const ratingsResult = await pool.query(ratingsQuery, [slug]);

        res.json({
            film,
            ratings: ratingsResult.rows,
        });
    } catch (error) {
        console.error('Error fetching film details:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Function to get all community members with pagination
export const getMembers = async (req, res) => {
    try {
        // Extract page
        const {
            page = 1,
            limit = 25,       // same as membersPerPage
            sort = 'Watched',
        } = { ...req.query };

        const offset = (page - 1) * limit;  // for pagination

        let query = `
            SELECT
                COUNT(*) OVER() AS total_count,
                user_id,
                username,
                display_name,
                num_films_watched
            FROM
                users
            ORDER BY num_films_watched DESC
            LIMIT $1 OFFSET $2
        `;

        // if sort is 'Watched', just use the above query
        // if sort is 'Name', reassign query to use the below
        // this is because you can't parameterize the ORDER BY value
        if (sort === 'Name') {
            query = `
                SELECT
                    COUNT(*) OVER() AS total_count,
                    user_id,
                    username,
                    display_name,
                    num_films_watched
                FROM
                    users
                ORDER BY display_name ASC
                LIMIT $1 OFFSET $2
            `;
        }

        const { rows } = await pool.query(query, [limit, offset]);
        console.log(`Query returned ${rows.length} rows.`);
        if (rows.length > 0) {
            console.log(`total_count: ${rows[0].total_count}`);
        }
        res.json(rows);
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};