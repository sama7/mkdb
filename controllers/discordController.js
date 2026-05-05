import 'dotenv/config';
import path from 'path';
import sharp from 'sharp';
import pool from '../db/conn.js';
import { getFilmDetails } from './filmController.js';
import { apiRequest, paginate } from '../sync/lbx-client.js';

const POSTER_DIR = path.resolve('images/posters');
const SLUG_RE = /^[a-z0-9-]+$/;

function slugFromLink(link) {
    if (!link) return null;
    const m = link.match(/\/film\/([^/]+)\/?/);
    return m ? m[1].toLowerCase() : null;
}

async function searchSlug(rawQuery) {
    const j = await apiRequest('GET', '/search', {
        query: { input: rawQuery, include: 'FilmSearchItem', perPage: '1' },
    });
    return slugFromLink(j.items?.[0]?.film?.link);
}

/** ──────────────────────────────────────────────────────────────────────────
 * /api/discord/films/search?query=<text>
 * 1. hit the official Letterboxd API search endpoint
 * 2. pick first film result → slug
 * 3. delegate to getFilmDetails(slug)
 * ────────────────────────────────────────────────────────────────────────── */
export const searchFilm = async (req, res) => {
    const rawQuery = String(req.query.query ?? '');

    if (!rawQuery) {
        return res.status(400).json({ error: 'Query is required.' });
    }

    try {
        const slug = await searchSlug(rawQuery);

        if (!slug) {
            return res
                .status(404)
                .json({ code: 'NO_LETTERBOXD_RESULT', message: 'No film found.' });
        }

        const fakeReq = { params: { slug } };

        let detailsPayload;

        const fakeRes = {
            json: (p) => { detailsPayload = p; },
            status: (code) => ({
                json: (p) => { throw { code, payload: p }; },
            }),
        };

        try {
            await getFilmDetails(fakeReq, fakeRes);
        } catch (err) {
            console.log('Error in getFilmDetails:', err);

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
 * GET /api/discord/films/ratings?query=<title>
 * – Finds a film by Letterboxd API search and returns:
 *   { slug, film, ratings }
 */
export const searchFilmRatings = async (req, res) => {
    const rawQuery = String(req.query.query ?? '');

    if (!rawQuery) {
        return res.status(400).json({ error: 'Query is required.' });
    }

    try {
        const slug = await searchSlug(rawQuery);

        if (!slug) {
            return res
                .status(404)
                .json({ code: 'NO_LETTERBOXD_RESULT', message: 'No film found.' });
        }

        const fakeReq = { params: { slug } };
        let details;
        const fakeRes = {
            json: (payload) => { details = payload; },
            status: (code) => ({
                json: (payload) => { throw { code, payload }; },
            }),
        };

        try {
            await getFilmDetails(fakeReq, fakeRes);
        } catch (err) {
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

        return res.json({
            slug,
            film: details.film,
            ratings: details.ratings,
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

function pickContributorPhoto(poster) {
    const sizes = poster?.sizes;
    if (!Array.isArray(sizes) || sizes.length === 0) return null;
    const atLeast300 = sizes.filter((s) => s.width >= 300).sort((a, b) => a.width - b.width);
    return (atLeast300[0] ?? sizes.reduce((b, s) => (s.width > b.width ? s : b)))?.url ?? null;
}

function shapeContributor(c, type) {
    // The Letterboxd API returns the contributor's *primary* role URL
    // (e.g. /director/georges-melies-1/ for Méliès, even when the user
    // ran /mkdb actor). Rewrite the role segment to match the request so
    // each subcommand links to the matching filter view.
    const lbxLink = c.links?.find((l) => l.type === 'letterboxd');
    let profileUrl = lbxLink?.url || null;
    if (profileUrl && (type === 'Director' || type === 'Actor')) {
        const role = type.toLowerCase();
        const m = profileUrl.match(/^(https:\/\/letterboxd\.com\/)[^/]+\/([^/]+)\/?$/);
        if (m) profileUrl = `${m[1]}${role}/${m[2]}/`;
    }
    return {
        name: c.name,
        lid: c.id,
        photo_url: pickContributorPhoto(c.poster) || pickContributorPhoto(c.customPoster),
        profile_url: profileUrl,
    };
}

/**
 * GET /api/discord/films/by-contributor?query=<name>&type=Director|Actor
 * 1. Search Letterboxd for the contributor (person)
 * 2. Page their contributions of the given type
 * 3. JOIN against `films` to keep only ones present in MKDb
 * 4. Return contributor info + films sorted by current rank
 */
export const filmsByContributor = async (req, res) => {
    const rawQuery = String(req.query.query ?? '');
    const type = String(req.query.type ?? '');

    if (!rawQuery) return res.status(400).json({ error: 'Query is required.' });
    if (!['Director', 'Actor'].includes(type)) {
        return res.status(400).json({ error: 'type must be Director or Actor.' });
    }

    try {
        const search = await apiRequest('GET', '/search', {
            query: { input: rawQuery, include: 'ContributorSearchItem', perPage: '1' },
        });
        const hit = search.items?.[0]?.contributor;
        if (!hit) {
            return res.status(404).json({ code: 'NO_CONTRIBUTOR_FOUND', message: 'No person found.' });
        }

        const full = await apiRequest('GET', `/contributor/${encodeURIComponent(hit.id)}`);
        const contributor = shapeContributor(full, type);

        const MAX_LIDS = 500;
        const lids = [];
        for await (const item of paginate(`/contributor/${encodeURIComponent(hit.id)}/contributions`, { type, perPage: 100 })) {
            const lid = item?.film?.id;
            if (lid) lids.push(lid);
            if (lids.length >= MAX_LIDS) break;
        }

        if (lids.length === 0) {
            return res.json({ contributor, films: [], total_letterboxd: 0 });
        }

        const { rows } = await pool.query(
            `WITH latest AS (SELECT MAX(week) AS wk FROM film_rankings_history)
             SELECT
               f.title,
               f.year,
               f.slug,
               (SELECT frh.ranking
                  FROM film_rankings_history frh
                  JOIN latest l ON frh.week = l.wk
                 WHERE frh.film_id = f.film_id) AS current_rank,
               AVG(r.rating) AS average_rating,
               COUNT(r.rating) AS rating_count
             FROM films f
             JOIN ratings r ON r.film_id = f.film_id
             WHERE f.letterboxd_id = ANY($1::text[])
             GROUP BY f.film_id
             ORDER BY current_rank ASC NULLS LAST,
                      AVG(r.rating) DESC,
                      f.year DESC NULLS LAST`,
            [lids],
        );

        return res.json({
            contributor,
            films: rows,
            total_letterboxd: lids.length,
        });
    } catch (err) {
        console.error('Error in /films/by-contributor:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * GET /api/discord/posters-grid?slugs=a,b,c,...
 * Renders up to 8 posters in a 4x2 JPEG grid for embedding in Discord.
 */
export const getPostersGrid = async (req, res) => {
    const raw = String(req.query.slugs ?? '');
    const slugs = raw.split(',').filter((s) => SLUG_RE.test(s)).slice(0, 8);
    if (slugs.length === 0) return res.status(400).json({ error: 'slugs required' });

    const COLS = 4, ROWS = 2;
    const CELL_W = 230, CELL_H = 345;
    const GAP = 6;
    const W = COLS * CELL_W + (COLS + 1) * GAP;
    const H = ROWS * CELL_H + (ROWS + 1) * GAP;

    try {
        const tiles = await Promise.all(
            slugs.map(async (slug, i) => {
                try {
                    const buf = await sharp(path.join(POSTER_DIR, `${slug}.jpg`))
                        .resize(CELL_W, CELL_H, { fit: 'cover' })
                        .toBuffer();
                    return {
                        input: buf,
                        left: GAP + (i % COLS) * (CELL_W + GAP),
                        top: GAP + Math.floor(i / COLS) * (CELL_H + GAP),
                    };
                } catch {
                    return null;
                }
            }),
        );

        const out = await sharp({
            create: {
                width: W,
                height: H,
                channels: 3,
                background: { r: 24, g: 25, b: 28 },
            },
        })
            .composite(tiles.filter(Boolean))
            .jpeg({ quality: 82 })
            .toBuffer();

        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(out);
    } catch (err) {
        console.error('Error in /posters-grid:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
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