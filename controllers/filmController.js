import pool from '../db/conn.js';

// Function to get film rankings with optional filters
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
                    f.title, f.year, f.slug, f.genres
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
        console.error('Error fetching film rankings:', error);
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
            SELECT u.username, r.rating
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