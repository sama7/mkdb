/**
 * Truncate text on a word-boundary and append an ellipsis.
 * Discord's embed description limit is 4096 chars - we keep it small (500).
 */
export function truncateSynopsis(text: string | null | undefined, max = 500): string {
    if (!text) return '';
    if (text.length <= max) return text;
    const slice = text.slice(0, max);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
}

/**
 * Convert a runtime in minutes to "Hh Mm" / "Hh" / "Mm".
 * Returns an empty string when runtime is nullish or 0.
 */
export function formatRuntime(mins: number | null | undefined = 0): string {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}
