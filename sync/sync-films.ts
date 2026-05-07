import fs from 'fs';
import path from 'path';
import pool from '../db/conn.js';
import { apiRequest } from './lbx-client.js';
import { downloadImage } from './download-image.js';

const POSTER_DIR = path.resolve('images/posters');
const POSTER_MIN_BYTES = 118;

interface NameObject {
    name?: string;
}

interface ImageSize {
    width: number;
    url: string;
}

interface FilmPosterSource {
    sizes?: ImageSize[];
}

interface FilmLink {
    type?: string;
    url?: string;
}

interface FilmContribution {
    type?: string;
    contributors?: NameObject[];
}

interface PendingFilmRow {
    film_id: number;
    letterboxd_id: string;
    slug: string;
    title: string | null;
}

interface LetterboxdFilmDetail {
    adult?: boolean;
    adultPoster?: FilmPosterSource;
    poster?: FilmPosterSource;
    link?: string;
    contributions?: FilmContribution[];
    directors?: NameObject[];
    genres?: NameObject[];
    countries?: NameObject[];
    languages?: NameObject[];
    links?: FilmLink[];
    description?: string;
    releaseYear?: number;
    runTime?: number;
    name?: string;
}

function slugFromLink(link?: string): string | null {
    if (!link) return null;
    const m = link.match(/\/film\/([^/]+)\/?/);
    return m ? m[1].toLowerCase() : null;
}

function pickPoster(film: LetterboxdFilmDetail): string | null {
    const source = film?.adult ? film?.adultPoster : film?.poster;
    const sizes = source?.sizes;
    if (!Array.isArray(sizes) || sizes.length === 0) return null;
    // Target ~300px wide (closest to the 230x345 posters from the old scraper).
    // Prefer the smallest size that is >= 300px; fall back to the largest available.
    const atLeast300 = sizes.filter((s) => s.width >= 300).sort((a, b) => a.width - b.width);
    return (atLeast300[0] ?? sizes.reduce((b, s) => (s.width > b.width ? s : b)))?.url ?? null;
}

function tmdbUrlFromLinks(links?: FilmLink[]): string | null {
    if (!Array.isArray(links)) return null;
    const tmdb = links.find((l) => l?.type === 'tmdb');
    return tmdb?.url || null;
}

function directorNamesFromContributions(contributions?: FilmContribution[], fallback?: NameObject[]): string[] {
    if (Array.isArray(contributions)) {
        const directors = contributions.find((c) => c?.type === 'Director');
        if (directors?.contributors) {
            const names = directors.contributors.map((c) => c.name).filter((name): name is string => Boolean(name));
            if (names.length) return names;
        }
    }
    if (Array.isArray(fallback)) return fallback.map((d) => d.name).filter((name): name is string => Boolean(name));
    return [];
}

function namesArray(arr?: NameObject[]): string[] {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => x?.name).filter((name): name is string => Boolean(name));
}

async function fetchAndStoreFilm(film: PendingFilmRow): Promise<boolean> {
    const detail = await apiRequest<LetterboxdFilmDetail>('GET', `/film/${encodeURIComponent(film.letterboxd_id)}`);
    const slug = slugFromLink(detail.link) || film.slug;
    const slugChanged = slug !== film.slug;

    const directors = directorNamesFromContributions(detail.contributions, detail.directors);
    const genres = namesArray(detail.genres);
    const countries = namesArray(detail.countries);
    const languages = namesArray(detail.languages);
    const tmdb = tmdbUrlFromLinks(detail.links);
    const synopsis = detail.description || null;
    const year = detail.releaseYear ?? null;
    const runtime = detail.runTime ?? null;
    const title = detail.name || film.title || slug;

    const posterUrl = pickPoster(detail);
    if (posterUrl) {
        try {
            fs.mkdirSync(POSTER_DIR, { recursive: true });
            const dest = path.join(POSTER_DIR, `${slug}.jpg`);
            await downloadImage(posterUrl, dest);
            const size = fs.statSync(dest).size;
            if (size <= POSTER_MIN_BYTES) {
                console.warn(`[films] poster for ${slug} downloaded but tiny (${size} bytes), keeping for retry`);
                return false;
            }
            if (slugChanged) {
                const oldPath = path.join(POSTER_DIR, `${film.slug}.jpg`);
                try { fs.unlinkSync(oldPath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
            }
        } catch (err) {
            console.warn(`[films] poster download failed for ${slug}:`, err.message);
            return false;
        }
    }

    if (year == null) console.warn(`[films] ${slug} has no release year from API`);

    await pool.query(
        `UPDATE films
            SET title = $1,
                slug = $2,
                year = $3,
                synopsis = $4,
                genres = $5,
                runtime = $6,
                directors = $7,
                countries = $8,
                languages = $9,
                tmdb = $10,
                details_fetched_at = NOW(),
                time_modified = NOW()
          WHERE letterboxd_id = $11`,
        [title, slug, year, synopsis, genres, runtime, directors, countries, languages, tmdb, film.letterboxd_id],
    );
    return true;
}

export async function syncNewFilms({ limit }: { limit?: number | null } = {}): Promise<{ ok: number; failed: number; total: number }> {
    const { rows: pending } = await pool.query<PendingFilmRow>(
        `SELECT film_id, letterboxd_id, slug, title FROM films
          WHERE letterboxd_id IS NOT NULL AND details_fetched_at IS NULL
          ORDER BY film_id
          ${limit ? `LIMIT ${Number(limit)}` : ''}`,
    );
    console.log(`[films] ${pending.length} films pending detail fetch`);

    let ok = 0, failed = 0;
    for (const [i, film] of pending.entries()) {
        try {
            const ran = await fetchAndStoreFilm(film);
            if (ran) ok++;
            else failed++;
        } catch (err) {
            failed++;
            console.warn(`[films] ${film.slug} (${film.letterboxd_id}) failed:`, err.message);
        }
        if ((i + 1) % 25 === 0 || i === pending.length - 1) {
            console.log(`[films] ${i + 1}/${pending.length} (ok=${ok}, failed=${failed})`);
        }
    }
    return { ok, failed, total: pending.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const limitArg = process.argv.find((a) => a.startsWith('--limit='));
    const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
    syncNewFilms({ limit })
        .then(() => pool.end())
        .catch((err) => {
            console.error('[films] fatal:', err);
            process.exit(1);
        });
}
