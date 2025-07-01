import * as cheerio from 'cheerio';
import 'dotenv/config';
import pool from '../db/conn.js';
import { getFilmDetails } from './filmController.js';   // <- existing method

/** ──────────────────────────────────────────────────────────────────────────
 * /api/discord/films/search?query=<text>
 * 1. take the raw query exactly as sent
 * 2. fetch Letterboxd’s HTML search endpoint (no Puppeteer)
 * 3. pick first film result → slug (data‑film‑slug attr)
 * 4. delegate to getFilmDetails(slug)
 * ────────────────────────────────────────────────────────────────────────── */
export const searchFilm = async (req, res) => {
    const rawQuery = String(req.query.query ?? '');

    if (!rawQuery) {
        return res.status(400).json({ error: 'Query is required.' });
    }

    const encoded = encodeURIComponent(rawQuery);
    const url = `https://letterboxd.com/s/search/${encoded}/?adult`;

    try {
        /* ---------- 1) Fetch the HTML of the search results ---------- */
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Letterboxd returned ${response.status}`);
        }
        const html = await response.text();

        /* ---------- 2) Parse and extract first film slug ---------- */
        const $ = cheerio.load(html);
        const slug = $('div[data-type="film"][data-film-slug]').first().attr('data-film-slug');

        if (!slug) {
            // Nothing came back from Letterboxd
            return res
                .status(404)
                .json({ code: 'NO_LETTERBOXD_RESULT', message: 'No film found.' });
        }

        /* ---------- 3) Re‑use getFilmDetails(slug) ---------- */
        const fakeReq = { params: { slug } };

        let detailsPayload;          // will hold { film, ratings? }

        const fakeRes = {
            json: (p) => { detailsPayload = p; },
            status: (code) => ({
                json: (p) => { throw { code, payload: p }; },   // propagate status
            }),
        };

        try {
            await getFilmDetails(fakeReq, fakeRes);
        } catch (err) {
            console.log('Error in getFilmDetails:', err);

            // ── FILM EXISTS ON LETTERBOXD BUT NOT ON MKDb ────────────────
            // getFilmDetails turns our internal 404 into its own 500
            // so we have to look for that pattern here.
            const notFound =
                (Number(err.code) === 404) ||
                (Number(err.code) === 500 && err.payload?.error === 'Film not found');

            if (notFound) {
                return res.status(404).json({
                    code: 'NOT_ON_MKDB',
                    slug,
                    message: 'Film exists on Letterboxd but not on MKDb.',
                });
            }
            throw err;
        }

        /* ---------- 4) Return slug + film (same shape as before) ----- */
        return res.json({
            slug,
            film: detailsPayload.film,
        });
    } catch (err) {
        console.error('Error in /films/search:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * GET /api//discord/films/ratings?query=<title>
 * – Finds a film by Letterboxd search and returns:
 *   { slug, film, ratings }
 */
export const searchFilmRatings = async (req, res) => {
    const rawQuery = String(req.query.query ?? '');

    if (!rawQuery) {
        return res.status(400).json({ error: 'Query is required.' });
    }

    const encoded = encodeURIComponent(rawQuery);
    const url = `https://letterboxd.com/s/search/${encoded}/?adult`;

    try {
        /* ---------- 1) Fetch the HTML of the search results ---------- */
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Letterboxd returned ${response.status}`);
        }
        const html = await response.text();

        /* ---------- 2) Parse and extract first film slug ---------- */
        const $ = cheerio.load(html);
        const slug = $('div[data-type="film"][data-film-slug]').first().attr('data-film-slug');

        if (!slug) {
            // Nothing came back from Letterboxd
            return res
                .status(404)
                .json({ code: 'NO_LETTERBOXD_RESULT', message: 'No film found.' });
        }

        /* ---------- 3) Re‑use getFilmDetails() ---------- */
        const fakeReq = { params: { slug } };
        let details;
        const fakeRes = {
            json: (payload) => {
                details = payload; // { film, ratings }
            },
            status: (code) => ({
                json: (payload) => {
                    throw { code, payload }; // bubble‐up errors
                },
            }),
        };

        try {
            await getFilmDetails(fakeReq, fakeRes);
        } catch (err) {
            // ── FILM EXISTS ON LBx BUT NOT ON MKDb ───────────────────
            const notFound =
                (Number(err.code) === 404) ||
                (Number(err.code) === 500 && err.payload?.error === 'Film not found');

            if (notFound) {
                return res.status(404).json({
                    code: 'NOT_ON_MKDB',
                    slug,
                    message: 'Film exists on Letterboxd but not on MKDb.',
                });
            }
            throw err;           // bubble-up any genuine failure
        }

        /* ---------- 4) Respond with film + ratings ---------- */
        return res.json({
            slug,
            film: details.film,         // { title, year, synopsis, current_rank, … }
            ratings: details.ratings,   // [{ username, display_name, rating }, …]
        });
    } catch (err) {
        console.error('Error in /films/ratings:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get a film by its current MKDb rank (1 – 1000)
export const getFilmByRank = async (req, res) => {
    try {
        const rank = Number(req.params.rank);

        // basic input guard
        if (!Number.isInteger(rank) || rank < 1 || rank > 1000) {
            return res
                .status(400)
                .json({ error: 'Rank must be an integer between 1 and 1000.' });
        }

        /* ------------------------------------------------------------
           Pull latest‑week ranking, then film & rating aggregates
        ------------------------------------------------------------- */
        const query = `
      WITH latest AS (
        SELECT MAX(week) AS wk FROM film_rankings_history
      )
      SELECT
        f.title,
        f.year,
        f.slug,
        f.directors,
        f.genres,
        f.countries,
        f.languages,
        f.runtime,
        f.synopsis,
        frh.ranking           AS current_rank,
        AVG(r.rating)         AS average_rating,
        COUNT(r.rating)       AS rating_count
      FROM films                   f
      JOIN film_rankings_history   frh ON frh.film_id = f.film_id
      JOIN latest                  l   ON frh.week    = l.wk
      JOIN ratings                 r   ON r.film_id   = f.film_id
      WHERE frh.ranking = $1
      GROUP BY f.film_id, frh.ranking
      LIMIT 1;
    `;

        const { rows } = await pool.query(query, [rank]);
        const film = rows[0];

        if (!film) {
            return res
                .status(404)
                .json({ error: `No film found at rank ${rank}.` });
        }

        // Same envelope shape as getFilmDetails (minus ratings array)
        res.json({ film });
    } catch (err) {
        console.error('Error fetching film by rank:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * GET  /films/nearmank/:rank   (1 ≤ rank ≤ 100)
 * Top-50 films by highest average ★ (≥ 7 ratings && ≤ 9 ratings)
 */
export const getNearMankFilmByRank = async (req, res) => {
    const rank = Number(req.params.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > 100) {
        return res.status(400).json({ error: 'Rank must be between 1 and 100.' });
    }

    try {
        const query = `
      WITH ranked AS (
        SELECT
          f.film_id,
          f.title,
          f.year,
          f.slug,
          f.directors,
          f.genres,
          f.countries,
          f.languages,
          f.runtime,
          f.synopsis,
          AVG(r.rating)               AS average_rating,
          COUNT(r.rating)             AS rating_count,
          ROW_NUMBER() OVER (ORDER BY AVG(r.rating) DESC,
                                      COUNT(r.rating) DESC) AS ranking
        FROM   films   f
        JOIN   ratings r ON r.film_id = f.film_id
        WHERE  f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
        GROUP  BY f.film_id
        HAVING COUNT(r.rating) BETWEEN 7 AND 9            -- 7 ≤ ratings ≤ 9
      )
      SELECT
        ranked.*,
        (
          SELECT frh.ranking
          FROM   film_rankings_history frh
          WHERE  frh.film_id = ranked.film_id
          AND    frh.week = (SELECT MAX(week) FROM film_rankings_history)
        ) AS current_rank
      FROM ranked
      WHERE ranked.ranking = $1;
    `;

        const { rows } = await pool.query(query, [rank]);
        if (!rows[0])
            return res.status(404).json({ error: 'Rank not found.' });

        res.json({ film: rows[0] });
    } catch (err) {
        console.error('Error in getNearMankFilmByRank:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};