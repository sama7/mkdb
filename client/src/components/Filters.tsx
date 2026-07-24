import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FilterOptions, FiltersState, MultiSelectField, MultiSelectFilters } from '../types';
import MultiSelectFilter, { type AsyncOption } from './MultiSelectFilter';
import '../filters.css';

// Fallback genre list so the filter still works if /api/filter-options fails.
const FALLBACK_GENRES = [
    'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
    'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance',
    'Science Fiction', 'Thriller', 'TV Movie', 'War', 'Western',
];

const MULTI_FIELDS: { key: MultiSelectField; label: string }[] = [
    { key: 'genres', label: 'Genre' },
    { key: 'directors', label: 'Director' },
    { key: 'countries', label: 'Country' },
    { key: 'languages', label: 'Language' },
];

const RANGE_FIELDS = [
    { label: 'Release Year', min: 'minYear', max: 'maxYear', placeholder: ['From', 'To'] },
    { label: 'Rating Count', min: 'minRatings', max: 'maxRatings', placeholder: ['Min', 'Max'] },
    { label: 'Runtime (min)', min: 'minRuntime', max: 'maxRuntime', placeholder: ['Min', 'Max'] },
] as const;

type RangeKey = 'minYear' | 'maxYear' | 'minRatings' | 'maxRatings' | 'minRuntime' | 'maxRuntime';
const RANGE_KEYS: RangeKey[] = ['minYear', 'maxYear', 'minRatings', 'maxRatings', 'minRuntime', 'maxRuntime'];

interface FiltersProps {
    filters: FiltersState;
    onFiltersChange: (filters: FiltersState) => void;
    /**
     * The minimum rating count the API applies when the field is left blank
     * (10 for the metro rankings, 5 for lank). Surfaced in the UI so the
     * implicit filtering isn't invisible to users.
     */
    defaultMinRatings?: number;
}

const toDraft = (f: FiltersState): FiltersState => ({
    minYear: f.minYear || '',
    maxYear: f.maxYear || '',
    minRatings: f.minRatings || '',
    maxRatings: f.maxRatings || '',
    minRuntime: f.minRuntime || '',
    maxRuntime: f.maxRuntime || '',
    genres: f.genres || {},
    directors: f.directors || {},
    countries: f.countries || {},
    languages: f.languages || {},
});

/** Strip empty strings / empty objects so the query string stays clean. */
function normalize(draft: FiltersState): FiltersState {
    const out: FiltersState = {};
    RANGE_KEYS.forEach((k) => { if (draft[k]) out[k] = draft[k]; });
    MULTI_FIELDS.forEach(({ key }) => {
        const sel = draft[key];
        if (sel && Object.keys(sel).length > 0) out[key] = sel;
    });
    return out;
}

function countActive(f: FiltersState): number {
    let n = 0;
    RANGE_KEYS.forEach((k) => { if (f[k]) n++; });
    MULTI_FIELDS.forEach(({ key }) => { n += Object.keys(f[key] || {}).length; });
    return n;
}

const RANGE_CHIP_LABELS: Record<RangeKey, string> = {
    minYear: 'Year ≥', maxYear: 'Year ≤',
    minRatings: 'Ratings ≥', maxRatings: 'Ratings ≤',
    minRuntime: 'Runtime ≥', maxRuntime: 'Runtime ≤',
};

const Filters = ({ filters, onFiltersChange, defaultMinRatings = 10 }: FiltersProps) => {
    const [draft, setDraft] = useState<FiltersState>(() => toDraft(filters));
    const [applied, setApplied] = useState<FiltersState>(() => normalize(toDraft(filters)));
    const [options, setOptions] = useState<FilterOptions>({ genres: FALLBACK_GENRES, countries: [], languages: [] });
    // Collapsed by default on small screens so the panel doesn't push the grid down.
    const [isOpen, setIsOpen] = useState(() =>
        typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/filter-options')
            .then((r) => (r.ok ? r.json() : null))
            .then((data: FilterOptions | null) => {
                if (!cancelled && data) {
                    setOptions({
                        genres: data.genres?.length ? data.genres : FALLBACK_GENRES,
                        countries: data.countries || [],
                        languages: data.languages || [],
                    });
                }
            })
            .catch(() => { /* keep fallbacks */ });
        return () => { cancelled = true; };
    }, []);

    const searchDirectors = useCallback(async (query: string): Promise<AsyncOption[]> => {
        const res = await fetch(`/api/directors/search?query=${encodeURIComponent(query)}&limit=25`);
        if (!res.ok) return [];
        return (await res.json()) as AsyncOption[];
    }, []);

    const setRange = (key: RangeKey, value: string) => setDraft((d) => ({ ...d, [key]: value }));

    // Tri-state cycle: none → include → exclude → none.
    const toggleValue = (field: MultiSelectField, value: string) => {
        setDraft((d) => {
            const current = { ...(d[field] || {}) } as MultiSelectFilters;
            const state = current[value];
            if (state === 'include') current[value] = 'exclude';
            else if (state === 'exclude') delete current[value];
            else current[value] = 'include';
            return { ...d, [field]: current };
        });
    };

    const apply = (next?: FiltersState) => {
        const source = next ?? draft;
        const normalized = normalize(source);
        setDraft(toDraft(source));
        setApplied(normalized);
        onFiltersChange(normalized);
    };

    const reset = () => {
        setDraft(toDraft({}));
        setApplied({});
        onFiltersChange({});
    };

    // Removing a chip takes effect immediately — that's what the ✕ implies.
    const removeChip = (field: MultiSelectField | RangeKey, value?: string) => {
        const next: FiltersState = { ...applied };
        if (value && MULTI_FIELDS.some((f) => f.key === field)) {
            const sel = { ...(next[field as MultiSelectField] || {}) };
            delete sel[value];
            next[field as MultiSelectField] = sel;
        } else {
            delete next[field as RangeKey];
        }
        apply(next);
    };

    const appliedCount = useMemo(() => countActive(applied), [applied]);
    const isDirty = useMemo(
        () => JSON.stringify(normalize(draft)) !== JSON.stringify(applied),
        [draft, applied],
    );

    const rangeChips = RANGE_KEYS
        .filter((k) => applied[k])
        .map((k) => ({ key: k, text: `${RANGE_CHIP_LABELS[k]} ${applied[k]}` }));

    return (
        <div className="filters-panel">
            <div className="filters-header">
                <button
                    type="button"
                    className="filters-toggle"
                    onClick={() => setIsOpen((v) => !v)}
                    aria-expanded={isOpen}
                >
                    <span className="filters-toggle-icon" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                    Filters
                    {appliedCount > 0 && <span className="filters-badge">{appliedCount}</span>}
                </button>
                {appliedCount > 0 && (
                    <button type="button" className="filters-reset" onClick={reset}>Clear all</button>
                )}
            </div>

            {isOpen && (
                <div className="filters-body">
                    <div className="filters-grid ranges">
                        {RANGE_FIELDS.map((f) => (
                            <div className="filter-field" key={f.label}>
                                <span className="filter-label">{f.label}</span>
                                <div className="range-inputs">
                                    <input
                                        type="number" inputMode="numeric" min="0"
                                        placeholder={f.placeholder[0]}
                                        value={(draft[f.min as RangeKey] as string) || ''}
                                        onChange={(e) => setRange(f.min as RangeKey, e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                                    />
                                    <span className="range-sep" aria-hidden="true">–</span>
                                    <input
                                        type="number" inputMode="numeric" min="0"
                                        placeholder={f.placeholder[1]}
                                        value={(draft[f.max as RangeKey] as string) || ''}
                                        onChange={(e) => setRange(f.max as RangeKey, e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
                                    />
                                </div>
                                {/* The API quietly applies a minimum rating count when this is
                                    blank; say so rather than leaving results silently filtered. */}
                                {f.min === 'minRatings' && !draft.minRatings && (
                                    <span className="filter-hint">
                                        Showing films with {defaultMinRatings}+ ratings
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="filters-grid selects">
                        {MULTI_FIELDS.map(({ key, label }) => (
                            <div className="filter-field" key={key}>
                                <span className="filter-label">{label}</span>
                                <MultiSelectFilter
                                    label={label}
                                    selections={draft[key] || {}}
                                    onToggle={(value) => toggleValue(key, value)}
                                    options={key === 'directors' ? undefined : options[key as 'genres' | 'countries' | 'languages']}
                                    asyncSearch={key === 'directors' ? searchDirectors : undefined}
                                    searchPlaceholder={key === 'directors' ? 'Type a director’s name…' : undefined}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="filters-actions">
                        <button
                            type="button"
                            className={`filters-apply${isDirty ? ' is-dirty' : ''}`}
                            onClick={() => apply()}
                        >
                            Apply Filters
                        </button>
                        {isDirty && <span className="filters-dirty-note">unapplied changes</span>}
                    </div>
                </div>
            )}

            {appliedCount > 0 && (
                <div className="filter-chips">
                    {rangeChips.map((c) => (
                        <button type="button" key={c.key} className="chip" onClick={() => removeChip(c.key)}>
                            {c.text}<span className="chip-x" aria-hidden="true">×</span>
                        </button>
                    ))}
                    {MULTI_FIELDS.flatMap(({ key, label }) =>
                        Object.entries(applied[key] || {}).map(([value, mode]) => (
                            <button
                                type="button"
                                key={`${key}-${value}`}
                                className={`chip ${mode}`}
                                onClick={() => removeChip(key, value)}
                                title={`${label}: ${mode === 'include' ? 'included' : 'excluded'}`}
                            >
                                <span className="chip-mode" aria-hidden="true">{mode === 'include' ? '✓' : '–'}</span>
                                {value}<span className="chip-x" aria-hidden="true">×</span>
                            </button>
                        )),
                    )}
                </div>
            )}
        </div>
    );
};

export default Filters;
