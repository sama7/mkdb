/**
 * Prepend an ISO-8601 UTC timestamp to every console line in the bot process.
 *
 * pm2 writes the bot's console output to a plain log file with no timestamps of
 * its own, so a failure like "MKDb search error" could not be placed in time.
 * Stamping in-process makes every line self-dating. This is the bot's copy of
 * lib/log-timestamps.ts — the bot is a separate package and can't import the
 * server's. Import for its side effect before anything else logs; idempotent.
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
