import 'dotenv/config';

/**
 * Parsing + autocomplete support for the filter options on `top`.
 *
 * Syntax (per option): a comma-separated list of values, each optionally
 * prefixed with `-` (or `!`) to exclude rather than include.
 *
 *     countries: japan, -usa        → must be Japanese, must not be American
 *     genres: drama, -comedy        → must be a Drama, must not be a Comedy
 *
 * Multiple included values are ANDed (a film must match all of them), which
 * mirrors the website's behaviour (`@>` on the array column). Excluded values
 * drop a film if it matches any of them (`NOT &&`).
 *
 * Typed values are resolved to the canonical database spelling — "usa" and
 * "United states" both land on "USA" — so users don't have to match casing.
 */


export type FilterMode = 'include' | 'exclude';
export type MultiSelectFilters = Record<string, FilterMode>;
export type ListField = 'genres' | 'countries' | 'languages';

export interface ParsedToken {
    raw: string;
    mode: FilterMode;
    /** The typed text with any leading -/! stripped. */
    term: string;
}

/** Split a raw option string into tokens, preserving include/exclude intent. */
export function tokenize(input: string): ParsedToken[] {
    return input
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((raw) => {
            const isExclude = raw.startsWith('-') || raw.startsWith('!');
            return {
                raw,
                mode: (isExclude ? 'exclude' : 'include') as FilterMode,
                term: (isExclude ? raw.slice(1) : raw).trim(),
            };
        })
        .filter((t) => t.term.length > 0);
}

/**
 * Pick the best canonical value for a typed term:
 * exact (case-insensitive) → prefix → substring. Returns null when nothing
 * plausibly matches so the caller can tell the user rather than silently
 * dropping the filter.
 */
export function resolveValue(term: string, options: string[]): string | null {
    const needle = term.toLowerCase();
    return (
        options.find((o) => o.toLowerCase() === needle) ??
        options.find((o) => o.toLowerCase().startsWith(needle)) ??
        options.find((o) => o.toLowerCase().includes(needle)) ??
        null
    );
}

export interface ResolveResult {
    filters: MultiSelectFilters;
    /** Terms we couldn't match to any known value. */
    unknown: string[];
}

/** Resolve a raw option string against a known list of valid values. */
export function resolveAgainstList(input: string | null, options: string[]): ResolveResult {
    const filters: MultiSelectFilters = {};
    const unknown: string[] = [];
    if (!input) return { filters, unknown };

    for (const token of tokenize(input)) {
        const match = resolveValue(token.term, options);
        if (match) filters[match] = token.mode;
        else unknown.push(token.raw);
    }
    return { filters, unknown };
}

// ---------------------------------------------------------------------------
// Option sources
// ---------------------------------------------------------------------------

interface FilterOptions { genres: string[]; countries: string[]; languages: string[] }

// Keyed by API base so each network caches its own copy. The vocabularies
// come from the shared `films` table and so are currently identical, but
// nothing here depends on that staying true.
const optionsCache = new Map<string, { data: FilterOptions; expiresAt: number }>();
const OPTIONS_TTL_MS = 30 * 60 * 1000;

/** Genres/countries/languages, cached — they only change on a weekly sync. */
export async function getFilterOptions(apiBase: string): Promise<FilterOptions> {
    const cached = optionsCache.get(apiBase);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
        const res = await fetch(`${apiBase}/filter-options`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as FilterOptions;
        optionsCache.set(apiBase, { data, expiresAt: Date.now() + OPTIONS_TTL_MS });
        return data;
    } catch (err) {
        console.warn('[filters] filter-options fetch failed:', (err as Error).message);
        return cached?.data ?? { genres: [], countries: [], languages: [] };
    }
}

/** Director type-ahead — ~29k distinct names, so this always hits the API. */
export async function searchDirectors(apiBase: string, query: string, limit = 25): Promise<string[]> {
    if (query.trim().length < 2) return [];
    try {
        const res = await fetch(
            `${apiBase}/directors/search?query=${encodeURIComponent(query.trim())}&limit=${limit}`,
        );
        if (!res.ok) return [];
        const rows = (await res.json()) as { name: string }[];
        return rows.map((r) => r.name);
    } catch {
        return [];
    }
}

/** Resolve the free-text `directors:` option to canonical director names. */
export async function resolveDirectors(apiBase: string, input: string | null): Promise<ResolveResult> {
    const filters: MultiSelectFilters = {};
    const unknown: string[] = [];
    if (!input) return { filters, unknown };

    for (const token of tokenize(input)) {
        const matches = await searchDirectors(apiBase, token.term, 5);
        const best = resolveValue(token.term, matches) ?? matches[0] ?? null;
        if (best) filters[best] = token.mode;
        else unknown.push(token.raw);
    }
    return { filters, unknown };
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

// Discord caps both the label and the submitted value of a choice at 100 chars.
const CHOICE_MAX = 100;

export interface Choice { name: string; value: string }

/**
 * Build accumulative autocomplete choices.
 *
 * Discord replaces the whole option value with whatever choice is picked, so
 * to support a multi-value field we complete only the segment currently being
 * typed and hand back the *entire* rebuilt string. Selecting a suggestion
 * therefore appends to the list instead of clobbering it.
 */
export function buildChoices(
    current: string,
    candidates: string[],
    { preserveOrder = false }: { preserveOrder?: boolean } = {},
): Choice[] {
    const lastComma = current.lastIndexOf(',');
    const prefix = lastComma === -1 ? '' : current.slice(0, lastComma + 1);
    const segment = (lastComma === -1 ? current : current.slice(lastComma + 1)).trim();
    const isExclude = segment.startsWith('-') || segment.startsWith('!');
    const term = (isExclude ? segment.slice(1) : segment).trim().toLowerCase();

    // Director results arrive already filtered and ranked by film count, which
    // is more useful than alphabetical — don't re-sort those.
    const ranked = preserveOrder || !term
        ? candidates
        : candidates
            .filter((c) => c.toLowerCase().includes(term))
            // exact/prefix matches first, then alphabetical
            .sort((a, b) => {
                const ap = a.toLowerCase().startsWith(term) ? 0 : 1;
                const bp = b.toLowerCase().startsWith(term) ? 0 : 1;
                return ap - bp || a.localeCompare(b);
            });

    const choices: Choice[] = [];
    for (const candidate of ranked) {
        const marker = isExclude ? '-' : '';
        const value = `${prefix}${prefix ? ' ' : ''}${marker}${candidate}`;
        if (value.length > CHOICE_MAX) continue;   // Discord would reject it
        choices.push({ name: value, value });
        if (choices.length >= 25) break;
    }
    return choices;
}

// ---------------------------------------------------------------------------
// Building the API query
// ---------------------------------------------------------------------------

export interface TopFilters {
    genres?: MultiSelectFilters;
    directors?: MultiSelectFilters;
    countries?: MultiSelectFilters;
    languages?: MultiSelectFilters;
    minYear?: number;
    maxYear?: number;
    minRuntime?: number;
    maxRuntime?: number;
    minRatings?: number;
    maxRatings?: number;
}

/** Human-readable summary of the active filters, for the embed footer. */
export function describeFilters(f: TopFilters): string[] {
    const parts: string[] = [];
    const describeList = (label: string, sel?: MultiSelectFilters) => {
        if (!sel) return;
        const inc = Object.entries(sel).filter(([, m]) => m === 'include').map(([v]) => v);
        const exc = Object.entries(sel).filter(([, m]) => m === 'exclude').map(([v]) => v);
        if (inc.length) parts.push(`${label}: ${inc.join(' + ')}`);
        if (exc.length) parts.push(`${label} excluding: ${exc.join(', ')}`);
    };
    describeList('Genre', f.genres);
    describeList('Director', f.directors);
    describeList('Country', f.countries);
    describeList('Language', f.languages);

    const range = (label: string, min?: number, max?: number, suffix = '') => {
        if (min !== undefined && max !== undefined) parts.push(`${label} ${min}–${max}${suffix}`);
        else if (min !== undefined) parts.push(`${label} ≥ ${min}${suffix}`);
        else if (max !== undefined) parts.push(`${label} ≤ ${max}${suffix}`);
    };
    range('Year', f.minYear, f.maxYear);
    range('Runtime', f.minRuntime, f.maxRuntime, 'm');
    range('Ratings', f.minRatings, f.maxRatings);
    return parts;
}

/** Drop empty selections so the query string stays tidy. */
export function normalizeFilters(f: TopFilters): TopFilters {
    const out: TopFilters = {};
    for (const [key, value] of Object.entries(f)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object' && Object.keys(value).length === 0) continue;
        (out as Record<string, unknown>)[key] = value;
    }
    return out;
}
