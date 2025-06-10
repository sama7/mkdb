import { validationResult, query as vQuery } from 'express-validator';
import { getBrowser } from '../helpers/puppeteer.js';
import 'dotenv/config';
import pool from '../db/conn.js';
import { getFilmDetails } from './filmController.js';   // <- existing method

/** ──────────────────────────────────────────────────────────────────────────
 * validateSearchQuery – middleware that makes sure “query” is reasonable
 * – only printable ASCII, 1–200 chars, no leading / trailing spaces, etc.
 * – blocks obvious injection / abuse vectors
 * ────────────────────────────────────────────────────────────────────────── */
export const validateSearchQuery = [
    vQuery('query')
        .trim()
        .isLength({ min: 1, max: 200 }).withMessage('Query must be 1‑200 chars.')
        .matches(/^[\p{L}\p{N}\s'!?.\-:,]+$/u).withMessage('Query contains disallowed characters.'),
];

async function safeGoto(page, url, options = { waitUntil: 'networkidle0', timeout: 60000 }) {
    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await page.goto(url, options);
            return; // Successfully loaded the page
        } catch (err) {
            console.warn(`Attempt ${attempt} failed for ${url}: ${err.message}`);
            // Add a delay before retrying (5–7 seconds)
            // "exponential" backoff strategy: delay increases with each attempt
            const delay = Math.floor(Math.random() * 2000 * attempt) + 5000;
            await new Promise(resolve => setTimeout(resolve, delay))
            if (attempt === 10) throw err; // Re-throw after 10 attempts
        }
    }
}

/** ──────────────────────────────────────────────────────────────────────────
 * /api/discord/films/search?query=<text>
 * 1. validate + sanitise                       (express‑validator)
 * 2. open Letterboxd search result w/ puppeteer
 * 3. grab first film link’s slug               (/film/<slug>/)
 * 4. delegate to getFilmDetails(slug)          (re‑use your existing code)
 * ────────────────────────────────────────────────────────────────────────── */
export const searchFilm = async (req, res) => {
    /* --------------- step 1: validation ---------------- */
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const rawQuery = req.query.query.trim();
    const encoded = encodeURIComponent(rawQuery).replace(/%20/g, '+');
    const url = `https://letterboxd.com/search/${encoded}/?adult`;

    let page;
    try {
        /* --------------- step 2: puppeteer scrape ---------- */
        const browser = await getBrowser();           // singleton
        page    = await browser.newPage();
        await safeGoto(page, url);

        /* --------------- step 3: pull slug ----------------- */
        const slug = await page.evaluate(() => {
            const anchor = document.querySelector('span.film-title-wrapper > a');
            if (!anchor) return null;
            const match = anchor.getAttribute('href')?.match(/^\/film\/([^/]+)\//);
            return match ? match[1] : null;
        });

        if (!slug) {
            return res.status(404).json({ error: 'No matching film found on Letterboxd.' });
        }

        /* --------------- step 4: reuse getFilmDetails ------- */
        // Build fake req/res to capture the JSON output
        const fakeReq = { params: { slug } };
        let detailsPayload;
        const fakeRes = {
            json: payload => { detailsPayload = payload; },
            status: code => ({
                json: payload => { throw { code, payload }; }, // propagate errors
            }),
        };

        await getFilmDetails(fakeReq, fakeRes);

        if (!detailsPayload || !detailsPayload.film) {
            return res.status(500).json({ error: 'Failed to retrieve film details.' });
        }

        /* --------------- step 5: send combined result ------- */
        return res.json({
            slug,
            film: detailsPayload.film,   // { title, year, … current_rank … }
            // ratings are available as detailsPayload.ratings if you need them
        });
    } catch (err) {
        console.error('Error in /films/search:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        /* always close resources */
        if (page) await page.close().catch(() => {});
    }
};

/**
 * GET /api//discord/films/ratings?query=<title>
 * – Finds a film by Letterboxd search and returns:
 *   { slug, film, ratings }
 */
export const searchFilmRatings = async (req, res) => {
    /* ---------- 1) Validate query string ---------- */
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const rawQuery = req.query.query.trim();
    const encoded = encodeURIComponent(rawQuery).replace(/%20/g, '+');
    const url = `https://letterboxd.com/search/${encoded}/?adult`;

    let page;
    try {
        /* ---------- 2) Puppeteer: grab first film slug ---------- */
        const browser = await getBrowser();
        page = await browser.newPage();
        await safeGoto(page, url);

        const slug = await page.evaluate(() => {
            const a = document.querySelector('span.film-title-wrapper > a');
            const m = a?.getAttribute('href')?.match(/^\/film\/([^/]+)\//);
            return m ? m[1] : null;
        });

        if (!slug) {
            return res
                .status(404)
                .json({ error: 'No matching film found on Letterboxd.' });
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

        await getFilmDetails(fakeReq, fakeRes);

        if (!details?.film) {
            return res
                .status(500)
                .json({ error: 'Failed to retrieve film details.' });
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
    } finally {
        if (page) await page.close().catch(() => {});
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