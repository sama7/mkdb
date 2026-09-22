/**
 * Display helpers for values the API can legitimately return as null.
 *
 * `num_films_watched` is populated from Letterboxd's /member/:id/statistics
 * endpoint during the weekly sync. A member whose sync leg failed (Letterboxd
 * outage, timeout) keeps a NULL count until the next run, so every render path
 * has to tolerate null rather than assume a number. Calling .toLocaleString()
 * on null throws, and an uncaught throw in render blanks the whole page.
 */

/** Em dash — "we don't have this number", visually distinct from a real 0. */
export const NO_VALUE = '—';

/** Format a count for display, falling back to an em dash when it is missing. */
export function formatCount(value: number | string | null | undefined): string {
    if (value == null) return NO_VALUE;
    const n = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(n)) return NO_VALUE;
    return n.toLocaleString();
}
