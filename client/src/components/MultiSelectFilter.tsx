import { useEffect, useMemo, useRef, useState } from 'react';
import type { MultiSelectFilters } from '../types';

export interface AsyncOption {
    name: string;
    filmCount?: number;
}

interface MultiSelectFilterProps {
    label: string;
    selections: MultiSelectFilters;
    onToggle: (value: string) => void;
    /** Full option list, for fields small enough to ship to the client. */
    options?: string[];
    /** Type-ahead source, for fields with too many values to preload (directors). */
    asyncSearch?: (query: string) => Promise<AsyncOption[]>;
    searchPlaceholder?: string;
    /** Minimum characters before an async search fires. */
    minQueryLength?: number;
}

/**
 * Tri-state multi-select dropdown: clicking an option cycles
 * include → exclude → cleared, matching how the genre filter has always
 * behaved. Selected values are pinned to the top of the list so they stay
 * visible (and removable) even when filtered out by the search box — which
 * matters for the async director field, where the list changes per query.
 */
export default function MultiSelectFilter({
    label,
    selections,
    onToggle,
    options,
    asyncSearch,
    searchPlaceholder,
    minQueryLength = 2,
}: MultiSelectFilterProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [asyncResults, setAsyncResults] = useState<AsyncOption[]>([]);
    const [isLoading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedValues = useMemo(() => Object.keys(selections), [selections]);
    const activeCount = selectedValues.length;

    // Close when clicking outside or pressing Escape.
    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [isOpen]);

    // Async search, debounced so typing doesn't spam the API.
    useEffect(() => {
        if (!asyncSearch || !isOpen) return;
        const trimmed = query.trim();
        if (trimmed.length < minQueryLength) {
            setAsyncResults([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const results = await asyncSearch(trimmed);
                if (!cancelled) setAsyncResults(results);
            } catch {
                if (!cancelled) setAsyncResults([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [query, asyncSearch, isOpen, minQueryLength]);

    // Rows to render: selected values first, then the (filtered) candidates.
    const rows = useMemo(() => {
        const candidates = asyncSearch
            ? asyncResults.map((r) => r.name)
            : (options || []).filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
        const seen = new Set(selectedValues);
        return [...selectedValues, ...candidates.filter((c) => !seen.has(c))];
    }, [asyncSearch, asyncResults, options, query, selectedValues]);

    const countsByName = useMemo(
        () => new Map(asyncResults.map((r) => [r.name, r.filmCount])),
        [asyncResults],
    );

    const showSearch = Boolean(asyncSearch) || (options?.length ?? 0) > 12;
    const trimmedQuery = query.trim();
    const needsMoreChars = Boolean(asyncSearch) && trimmedQuery.length > 0 && trimmedQuery.length < minQueryLength;

    return (
        <div className="ms-filter" ref={containerRef}>
            <button
                type="button"
                className={`ms-trigger${activeCount > 0 ? ' has-selection' : ''}${isOpen ? ' is-open' : ''}`}
                onClick={() => setIsOpen((v) => !v)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
            >
                <span className="ms-trigger-label">{label}</span>
                {activeCount > 0 && <span className="ms-count">{activeCount}</span>}
                <span className="ms-caret" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <div className="ms-panel" role="listbox">
                    {showSearch && (
                        <div className="ms-search">
                            <input
                                type="text"
                                value={query}
                                autoFocus
                                placeholder={searchPlaceholder || `Search ${label.toLowerCase()}…`}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                            {query && (
                                <button type="button" className="ms-search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
                            )}
                        </div>
                    )}

                    <div className="ms-hint">Click: include → exclude → clear</div>

                    <ul className="ms-list">
                        {isLoading && <li className="ms-empty">Searching…</li>}
                        {!isLoading && needsMoreChars && (
                            <li className="ms-empty">Type at least {minQueryLength} characters</li>
                        )}
                        {!isLoading && !needsMoreChars && rows.length === 0 && (
                            <li className="ms-empty">
                                {asyncSearch && !trimmedQuery ? `Search for a ${label.toLowerCase()}` : 'No matches'}
                            </li>
                        )}
                        {!isLoading && rows.map((value) => {
                            const state = selections[value];
                            const count = countsByName.get(value);
                            return (
                                <li
                                    key={value}
                                    className={`ms-option${state ? ` ${state}` : ''}`}
                                    onClick={() => onToggle(value)}
                                    role="option"
                                    aria-selected={state === 'include'}
                                >
                                    <span className={`ms-mark ${state || 'none'}`} aria-hidden="true">
                                        {state === 'include' ? '✓' : state === 'exclude' ? '–' : ''}
                                    </span>
                                    <span className="ms-option-label">{value}</span>
                                    {count !== undefined && <span className="ms-option-count">{count}</span>}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}
