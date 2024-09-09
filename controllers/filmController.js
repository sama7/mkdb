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
            limit = 100       // same as filmsPerPage
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
                average_rating,
                rating_count
            FROM (
                SELECT
                    f.title,
                    f.year,
                    f.slug,
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

        // Append any additional conditions for year if they exist
        if (conditions.length > 0) {
            query += ` AND ${conditions.join(' AND ')} `;
        }

        query += `
                GROUP BY
                    f.title, f.year, f.slug
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