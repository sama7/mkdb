/**
 * Prepend an ISO-8601 UTC timestamp to every console line.
 *
 * pm2 writes console output to plain log files with no timestamps of its own
 * (it isn't started with --time), which meant a production error could only be
 * placed in time by the log file's mtime. Stamping in the application makes
 * every line self-dating regardless of how the process is launched, so an error
 * can be tied to the request that caused it.
 *
 * Import this for its side effect before anything else logs. Idempotent — a
 * second import is a no-op, so it can't double-stamp.
 */
const FLAG = Symbol.for('mkdb.log-timestamps.installed');
const g = globalThis as unknown as Record<symbol, boolean>;

if (!g[FLAG]) {
    g[FLAG] = true;
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    for (const method of methods) {
        const original = console[method].bind(console);
        console[method] = (...args: unknown[]) => original(`[${new Date().toISOString()}]`, ...args);
    }
}

export {};
