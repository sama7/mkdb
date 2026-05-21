import 'dotenv/config';
import path from 'path';
import sharp from 'sharp';
import type { Request, Response } from 'express';
import pool from '../db/conn.js';
import { getFilmDetails } from './filmController.js';
import { apiRequest, paginate } from '../sync/lbx-client.js';
import type { FilmDetailsResponse } from '../types/api.js';

const POSTER_DIR = path.resolve('images/posters');
const SLUG_RE = /^[a-z0-9-]+$/;

interface ImageSize {
    width: number;
    url: string;
}

interface PosterSource {
    sizes?: ImageSize[];
}

interface LetterboxdFilmSearchResponse {
    items?: Array<{
        film?: {
            link?: string;
        };
    }>;
}

interface LetterboxdContributor {
    id?: string;
    name?: string;
    poster?: PosterSource;
    customPoster?: PosterSource;
    links?: Array<{
        type?: string;
        url?: string;
    }>;
}

interface LetterboxdContributorSearchResponse {
    items?: Array<{
        contributor?: LetterboxdContributor;
    }>;
}

interface LetterboxdContributionItem {
    film?: {
        id?: string;
    };
}

type ContributorType = 'Director' | 'Actor';

function isContributorType(value: string): value is ContributorType {
    return value === 'Director' || value === 'Actor';
}

function slugFromLink(link?: string): string | null {
    if (!link) return null;
    const m = link.match(/\/film\/([^/]+)\/?/);
    return m ? m[1].toLowerCase() : null;
}

async function searchSlug(rawQuery: string): Promise<string | null> {
    const j = await apiRequest<LetterboxdFilmSearchResponse>('GET', '/search', {
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
export const searchFilm = async (req: Request, res: Response) => {
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

        let detailsPayload: FilmDetailsResponse | undefined;

        // Reuse getFilmDetails (a route handler) to avoid duplicating its
        // SQL by handing it a minimal req/res mock. The double cast through
        // `unknown` is needed because the mock only implements the methods
        // getFilmDetails actually calls, not the full Response interface.
        const fakeReq = { params: { slug } } as Request<{ slug: string }>;
        const fakeRes = {
            json: (p: FilmDetailsResponse) => { detailsPayload = p; },
            status: (code: number) => ({
                json: (p: unknown) => { throw { code, payload: p }; },
            }),
        } as unknown as Response;

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
        if (!detailsPayload) throw new Error('Film details payload missing.');

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
export const searchFilmRatings = async (req: Request, res: Response) => {
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

        const fakeReq = { params: { slug } } as Request<{ slug: string }>;
        let details: FilmDetailsResponse | undefined;
        const fakeRes = {
            json: (payload: FilmDetailsResponse) => { details = payload; },
            status: (code: number) => ({
                json: (payload: unknown) => { throw { code, payload }; },
            }),
        } as unknown as Response;

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
        if (!details) throw new Error('Film details payload missing.');

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
export const getFilmByRank = async (req: Request<{ rank: string }>, res: Response) => {
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

function pickContributorPhoto(poster?: PosterSource): string | null {
    const sizes = poster?.sizes;
    if (!Array.isArray(sizes) || sizes.length === 0) return null;
    const atLeast300 = sizes.filter((s) => s.width >= 300).sort((a, b) => a.width - b.width);
    return (atLeast300[0] ?? sizes.reduce((b, s) => (s.width > b.width ? s : b)))?.url ?? null;
}

function shapeContributor(c: LetterboxdContributor, type: ContributorType) {
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
export const filmsByContributor = async (req: Request, res: Response) => {
    const rawQuery = String(req.query.query ?? '');
    const type = String(req.query.type ?? '');

    if (!rawQuery) return res.status(400).json({ error: 'Query is required.' });
    if (!isContributorType(type)) {
        return res.status(400).json({ error: 'type must be Director or Actor.' });
    }

    try {
        const search = await apiRequest<LetterboxdContributorSearchResponse>('GET', '/search', {
            query: { input: rawQuery, include: 'ContributorSearchItem', perPage: '1' },
        });
        const hit = search.items?.[0]?.contributor;
        if (!hit) {
            return res.status(404).json({ code: 'NO_CONTRIBUTOR_FOUND', message: 'No person found.' });
        }
        const contributorId = hit.id as string;

        const full = await apiRequest<LetterboxdContributor>('GET', `/contributor/${encodeURIComponent(contributorId)}`);
        const contributor = shapeContributor(full, type);

        const MAX_LIDS = 500;
        const lids: string[] = [];
        for await (const item of paginate<LetterboxdContributionItem>(`/contributor/${encodeURIComponent(contributorId)}/contributions`, { type, perPage: 100 })) {
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
 * Pick a grid shape for `n` posters (1-8) that minimizes empty cells.
 * Returns the canvas column count (the widest row) and per-row tile counts.
 *
 *   1 → 1×1     5 → top 3, bottom 2
 *   2 → 2×1     6 → 3×2
 *   3 → 3×1     7 → top 4, bottom 3
 *   4 → 4×1     8 → 4×2
 *
 * Short rows are centered horizontally on the canvas (see getPostersGrid).
 */
function gridLayout(n: number): { cols: number; rows: number; rowCounts: number[] } {
    if (n <= 1) return { cols: 1, rows: 1, rowCounts: [1] };
    if (n === 2) return { cols: 2, rows: 1, rowCounts: [2] };
    if (n === 3) return { cols: 3, rows: 1, rowCounts: [3] };
    if (n === 4) return { cols: 4, rows: 1, rowCounts: [4] };
    if (n === 5) return { cols: 3, rows: 2, rowCounts: [3, 2] };
    if (n === 6) return { cols: 3, rows: 2, rowCounts: [3, 3] };
    if (n === 7) return { cols: 4, rows: 2, rowCounts: [4, 3] };
    return { cols: 4, rows: 2, rowCounts: [4, 4] };
}

/**
 * GET /api/discord/posters-grid?slugs=a,b,c,...
 * Renders 1-8 posters as a JPEG grid for embedding in Discord. The grid
 * shape adapts to the slug count (see gridLayout) to avoid empty cells,
 * and short rows are horizontally centered so the result reads as a single
 * composition.
 *
 * Color rules:
 * - Canvas background: black.
 * - For each row, a medium-gray rectangle covers the row's posters plus a
 *   6px frame on every side. That's what reads as the "gap lines" between
 *   adjacent posters and the thin border around them.
 * - When a row is narrower than the widest row (n=5, n=7), the canvas
 *   extends past the gray frame and those margins stay black.
 */
export const getPostersGrid = async (req: Request, res: Response) => {
    const raw = String(req.query.slugs ?? '');
    const slugs = raw.split(',').filter((s) => SLUG_RE.test(s)).slice(0, 8);
    if (slugs.length === 0) return res.status(400).json({ error: 'slugs required' });

    const CELL_W = 230, CELL_H = 345;
    const GAP = 6;
    const BLACK = { r: 0, g: 0, b: 0 };
    const FRAME_COLOR = 'rgb(80,84,92)';   // medium gray — reads as separator against Discord's dark embed bg

    const { cols, rows, rowCounts } = gridLayout(slugs.length);
    const W = cols * CELL_W + (cols + 1) * GAP;
    const H = rows * CELL_H + (rows + 1) * GAP;

    // Per-row geometry. `contentLeft` is where this row's tile strip starts
    // after centering; rows shorter than `cols` get pushed inward so their
    // left/right margins are exposed (and stay black).
    const rowGeometry = rowCounts.map((rowCount, row) => {
        const contentW = rowCount * CELL_W + (rowCount - 1) * GAP;
        const contentLeft = (W - contentW) / 2;
        return { row, rowCount, contentLeft, contentW };
    });

    // One SVG with a gray rect per row, each rect = row's tile strip plus a
    // 6px frame on every side. Sharp composites this over the black canvas
    // before the actual poster tiles.
    const frameRects = rowGeometry.map(({ row, contentLeft, contentW }) => {
        const x = contentLeft - GAP;
        const y = row * (CELL_H + GAP);
        const w = contentW + 2 * GAP;
        const h = CELL_H + 2 * GAP;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${FRAME_COLOR}"/>`;
    }).join('');
    const frameSvg = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frameRects}</svg>`,
    );

    // Flatten (rowIdx, colIdx, contentLeft) for every poster slot so we can
    // map a slug index to its pixel position in one step.
    const slots: { row: number; col: number; contentLeft: number }[] = [];
    rowGeometry.forEach(({ row, rowCount, contentLeft }) => {
        for (let col = 0; col < rowCount; col++) slots.push({ row, col, contentLeft });
    });

    try {
        const tiles = await Promise.all(
            slugs.map(async (slug, i) => {
                try {
                    const buf = await sharp(path.join(POSTER_DIR, `${slug}.jpg`))
                        .resize(CELL_W, CELL_H, { fit: 'cover' })
                        .toBuffer();
                    const { row, col, contentLeft } = slots[i];
                    return {
                        input: buf,
                        left: Math.round(contentLeft + col * (CELL_W + GAP)),
                        top: GAP + row * (CELL_H + GAP),
                    };
                } catch {
                    return null;
                }
            }),
        );
        const overlays = tiles.filter((tile): tile is NonNullable<typeof tile> => Boolean(tile));

        const out = await sharp({
            create: {
                width: W,
                height: H,
                channels: 3,
                background: BLACK,
            },
        })
            .composite([
                { input: frameSvg, left: 0, top: 0 },
                ...overlays,
            ])
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
export const getNearMankFilmByRank = async (req: Request<{ rank: string }>, res: Response) => {
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
