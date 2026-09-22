/**
 * Live-site health check. Runs hourly from cron.
 *
 * The 2026-09-20 incident was invisible for ~14 hours because every layer
 * reported success: the sync exited 0, promote exited 0, nginx served 200s, and
 * the API returned well-formed JSON. The only broken thing was the *content* of
 * that JSON — 26 members with a NULL watched count, which sorted onto page 1
 * and crashed the React render. An uptime ping would have seen nothing wrong.
 *
 * So these checks assert on payloads, not status codes: each one encodes a
 * property the page actually needs in order to render.
 *
 * Alerts are deduplicated through a state file — a check that keeps failing
 * emails once, then stays quiet until it recovers, so a persistent outage does
 * not produce hourly mail. Recovery sends one "resolved" note.
 */
import 'dotenv/config';
import '../lib/log-timestamps.js';
import fs from 'node:fs';
import path from 'node:path';
import { sendCriticalAlert } from '../lib/alert.js';

const BASE = process.env.HEALTHCHECK_BASE_URL || 'https://www.mkdb.co';
const STATE_FILE = process.env.HEALTHCHECK_STATE_FILE
    || path.resolve('logs/healthcheck-state.json');
const TIMEOUT_MS = 20000;

interface CheckResult {
    name: string;
    ok: boolean;
    detail: string;
}

type State = Record<string, { failingSince: string; notified: boolean }>;

function readState(): State {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
    } catch {
        return {};
    }
}

function writeState(state: State): void {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getJson(pathname: string): Promise<unknown> {
    const res = await fetch(`${BASE}${pathname}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'mkdb-healthcheck' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Assert the shape the members page depends on.
 *
 * `num_films_watched` non-null is the specific invariant that broke: the client
 * formats it for display, and the API's default sort puts any NULL rows first,
 * so a single unpopulated member is enough to take over page 1.
 */
async function checkMembers(pathname: string, label: string): Promise<CheckResult> {
    const name = `members:${label}`;
    try {
        const rows = await getJson(pathname) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows)) return { name, ok: false, detail: 'response was not an array' };
        if (rows.length === 0) return { name, ok: false, detail: 'returned 0 members' };

        const nullWatched = rows.filter((r) => r.num_films_watched == null);
        if (nullWatched.length > 0) {
            const who = nullWatched.map((r) => String(r.username)).slice(0, 10).join(', ');
            return {
                name,
                ok: false,
                detail: `${nullWatched.length}/${rows.length} rows on page 1 have a null num_films_watched `
                    + `(${who}${nullWatched.length > 10 ? ', …' : ''}). The members page cannot render these.`,
            };
        }
        return { name, ok: true, detail: `${rows.length} rows, all complete` };
    } catch (err) {
        return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
}

/** A rankings endpoint that returns nothing means the promote produced no week. */
async function checkRankings(pathname: string, label: string): Promise<CheckResult> {
    const name = `rankings:${label}`;
    try {
        const rows = await getJson(pathname) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows) || rows.length === 0) {
            return { name, ok: false, detail: 'returned 0 films' };
        }
        return { name, ok: true, detail: `${rows.length} films` };
    } catch (err) {
        return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
}

/** The SPA shell itself — catches nginx or pm2 being down. */
async function checkShell(): Promise<CheckResult> {
    const name = 'site:shell';
    try {
        const res = await fetch(BASE, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status}` };
        const html = await res.text();
        if (!html.includes('<div id="root">')) {
            return { name, ok: false, detail: 'index.html did not contain the React root element' };
        }
        return { name, ok: true, detail: 'shell served' };
    } catch (err) {
        return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
}

async function main() {
    const results = [
        await checkShell(),
        await checkMembers('/api/members', 'metro'),
        await checkMembers('/api/lank/members', 'lank'),
        await checkRankings('/api/rankings', 'metro'),
        await checkRankings('/api/lank', 'lank'),
    ];

    for (const r of results) {
        console.log(`[healthcheck] ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}: ${r.detail}`);
    }

    const state = readState();
    const now = new Date().toISOString();
    const newlyBroken: CheckResult[] = [];
    const recovered: string[] = [];

    for (const r of results) {
        const prior = state[r.name];
        if (!r.ok) {
            if (!prior) {
                state[r.name] = { failingSince: now, notified: true };
                newlyBroken.push(r);
            } else if (!prior.notified) {
                prior.notified = true;
                newlyBroken.push(r);
            }
            // Already notified and still failing — stay quiet.
        } else if (prior) {
            recovered.push(`${r.name} (was failing since ${prior.failingSince})`);
            delete state[r.name];
        }
    }

    if (newlyBroken.length > 0) {
        const detail = newlyBroken.map((r) => `  ${r.name}\n    ${r.detail}`).join('\n\n');
        await sendCriticalAlert(
            `site check failed — ${newlyBroken.map((r) => r.name).join(', ')}`,
            `${BASE} failed ${newlyBroken.length} health check(s) at ${now}:\n\n${detail}\n\n` +
            `You will not get another email for these until they recover.\n\n` +
            `Checked: ${results.map((r) => `${r.name}=${r.ok ? 'ok' : 'FAIL'}`).join(', ')}`,
        );
    }

    if (recovered.length > 0) {
        await sendCriticalAlert(
            `site check recovered — ${recovered.length} check(s)`,
            `These checks are passing again:\n\n${recovered.map((r) => `  ${r}`).join('\n')}`,
        );
    }

    writeState(state);
    return results.every((r) => r.ok) ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('[healthcheck] fatal:', err);
        process.exit(1);
    });
