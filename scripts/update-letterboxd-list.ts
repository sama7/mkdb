// Pushes a network's current top-1000 to a Letterboxd list owned by samah_.
//
// Networks:
//   metro -> "MKDb Top 1000"  at letterboxd.com/samah_/list/mkdb-top-1000/
//   lank  -> "LKDb Top 1000"  at letterboxd.com/samah_/list/lkdb-top-1000/
//
// CLI:  node dist/scripts/update-letterboxd-list.js [metro|lank]   (default metro)
// Cron: chained after promote — see scripts/mkdb.crontab.
//
// Auth: refresh_token grant (LETTERBOXD_REFRESH_TOKEN) — gives an authenticated
// access token that's allowed to mutate my lists. Letterboxd doesn't rotate
// the refresh token on use.
//
// Discovered Letterboxd API quirks via probing:
//   - PATCH /list/{id} entries actions are 'ADD' / 'DELETE' / 'UPDATE'
//   - DELETE position is 0-INDEXED (DEL pos=0 removes 1-indexed position 1)
//   - ADD's position field is IGNORED — ADDs always append to the end
//   - Lists are capped at 1000 entries; ADDs that would exceed are silently
//     dropped from the batch
//   - Lists can't be reduced to 0 entries
//   - Duplicate film ADDs are silently skipped
//   - POST /lists accepts up to 1000 entries in one shot — used for first-time
//     creation of a list (the fast path); PATCH is for the recurring update.
//
// Update algorithm (when list already exists):
//   The list has no atomic "replace all entries" operation, so it's rebuilt in
//   place — but UNPUBLISHED first, so the public never sees a half-built list.
//   An unpublished list 404s for everyone but the owner (verified by probing),
//   and entry mutations still work while it's hidden. On success we republish;
//   on failure we deliberately leave it hidden rather than expose a broken list
//   (a re-run recovers it from any state).
//     Phase A: shrink to 1 entry via batches of DELETE pos=0 (many per PATCH)
//     Phase B: if leftover != target[0], replace it (ADD target[0], DELETE pos=0)
//     Phase C: bulk-ADD target[1..999] in batches of 100 (no dupes by design —
//              a single duplicate would reject the whole ADD batch)
//     Phase D: refetch, verify all 1000 positions match target
//     Then:   republish (published:true)

import 'dotenv/config';
import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { pathToFileURL } from 'node:url';
import pool from '../db/conn.js';

const BASE = 'https://api.letterboxd.com/api/v0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const THROTTLE_MS = 350;
const ADD_BATCH = 100;
const DELETE_BATCH = 100;   // DELETE pos=0 actions per PATCH; verified safe by probing
// A film Letterboxd no longer recognizes (IDs get retired when duplicate film
// entries are merged) is dropped rather than failing the whole run, but only up
// to this many. Beyond it something systemic is wrong — a broken token, a bad
// target query — and publishing a list with a big hole is worse than not
// publishing at all, so the run fails and leaves the list hidden.
const MAX_REJECTED = 10;

interface NetworkSpec {
    listName: string;
    description: string;
}

const NETWORKS: Record<'metro' | 'lank', NetworkSpec> = {
    metro: {
        listName: 'MKDb Top 1000',
        description: 'updates weekly on mondays\nsourced from <a href="https://mkdb.co" rel="nofollow">mkdb.co</a>',
    },
    lank: {
        listName: 'LKDb Top 1000',
        description: 'updates weekly on mondays\nsourced from <a href="https://mkdb.co/lank" rel="nofollow">mkdb.co/lank</a>',
    },
};

type NetworkKey = keyof typeof NETWORKS;

const CID = process.env.LETTERBOXD_CLIENT_ID;
const CSEC = process.env.LETTERBOXD_CLIENT_SECRET;
const RT = process.env.LETTERBOXD_REFRESH_TOKEN;
if (!CID || !CSEC || !RT) {
    throw new Error('LETTERBOXD_CLIENT_ID, LETTERBOXD_CLIENT_SECRET, and LETTERBOXD_REFRESH_TOKEN must be set');
}
const REQUIRED_CID = CID, REQUIRED_CSEC = CSEC, REQUIRED_RT = RT;

function sign(method: string, url: string, body: string): string {
    return crypto.createHmac('sha256', REQUIRED_CSEC).update(`${method}\0${url}\0${body || ''}`).digest('hex');
}
function buildUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null) q.set(k, String(v));
    q.set('apikey', REQUIRED_CID);
    q.set('nonce', crypto.randomUUID());
    q.set('timestamp', String(Math.floor(Date.now() / 1000)));
    return `${BASE}${path}?${q.toString()}`;
}

let lastRequestAt = 0;
async function throttle(): Promise<void> {
    const wait = Math.max(0, lastRequestAt + THROTTLE_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
}

export async function fetchAccessToken(): Promise<string> {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(REQUIRED_RT)}`;
    const url = buildUrl('/auth/token');
    const res = await fetch(url, {
        method: 'POST', body,
        headers: { Authorization: `Signature ${sign('POST', url, body)}`, 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
    return (await res.json() as { access_token: string }).access_token;
}

interface ApiResp { status: number; raw: string; parsed: { data?: unknown; messages?: { type: string; code: string; title: string }[] } | null }
async function apiRequest(method: string, token: string, path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<ApiResp> {
    await throttle();
    const bodyStr = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const url = buildUrl(path, query);
    const res = await fetch(url, {
        method, body: bodyStr || undefined,
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Signature': sign(method, url, bodyStr),
            'User-Agent': UA,
            Accept: 'application/json',
            ...(bodyStr && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    const raw = await res.text();
    let parsed: { data?: unknown; messages?: { type: string; code: string; title: string }[] } | null = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }
    return { status: res.status, raw, parsed };
}

interface ListSummary { id: string; name: string; filmCount: number; version: number; published: boolean }
interface ListEntry { rank: number; film: { id: string; name: string } }
interface PageResp<T> { items?: T[]; next?: string }

async function findListId(token: string, name: string): Promise<string | null> {
    const me = await apiRequest('GET', token, '/me');
    const memberId = (JSON.parse(me.raw) as { member?: { id: string } }).member?.id;
    if (!memberId) throw new Error('could not resolve /me member id');

    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
        const r = await apiRequest('GET', token, '/lists', { member: memberId, memberRelationship: 'Owner', perPage: 100, cursor });
        if (r.status !== 200) throw new Error(`/lists ${r.status}: ${r.raw.slice(0, 300)}`);
        const j = JSON.parse(r.raw) as PageResp<ListSummary>;
        for (const l of (j.items || [])) if (l.name === name) return l.id;
        if (!j.next || !j.items?.length) break;
        cursor = j.next;
    }
    return null;
}

async function fetchListEntries(token: string, listId: string): Promise<ListEntry[]> {
    const all: ListEntry[] = [];
    let cursor: string | undefined;
    for (;;) {
        const r = await apiRequest('GET', token, `/list/${listId}/entries`, { perPage: 100, cursor });
        if (r.status !== 200) throw new Error(`entries ${r.status}: ${r.raw.slice(0, 300)}`);
        const j = JSON.parse(r.raw) as PageResp<ListEntry>;
        if (j.items?.length) all.push(...j.items);
        if (!j.next || !j.items?.length) break;
        cursor = j.next;
    }
    return all.sort((a, b) => a.rank - b.rank);
}

async function getListSummary(token: string, listId: string): Promise<ListSummary> {
    const r = await apiRequest('GET', token, `/list/${listId}`);
    return JSON.parse(r.raw) as ListSummary;
}

interface PatchResult { status: number; version?: number; messages?: { type: string; code: string; title: string }[] }
async function patch(token: string, listId: string, body: unknown): Promise<PatchResult> {
    const r = await apiRequest('PATCH', token, `/list/${listId}`, {}, body);
    const data = r.parsed?.data as ListSummary | undefined;
    return { status: r.status, version: data?.version, messages: r.parsed?.messages };
}

async function setPublished(token: string, listId: string, published: boolean): Promise<void> {
    const r = await patch(token, listId, { published });
    if (r.status !== 200) throw new Error(`set published=${published} failed: ${r.status} ${JSON.stringify(r.messages)}`);
}

function errorMessages(messages?: { type: string; code: string; title: string }[]): { type: string; code: string; title: string }[] {
    return (messages ?? []).filter((m) => m.type === 'Error');
}

/**
 * ADD a run of films, returning the LIDs Letterboxd refused.
 *
 * An ADD batch is all-or-nothing: one unknown film ID rejects every entry in
 * the request (verified by probing — 0 of 9 valid films were added alongside
 * one bad one). A single retired LID would therefore lose a whole batch of 100,
 * fail verification, and leave the list unpublished. So a rejected batch is
 * bisected to isolate the offender(s) and add everything else, which costs only
 * ~log2(n) extra requests and doesn't depend on parsing the error text.
 *
 * A non-200 is a transport/auth failure rather than a bad film, and still throws.
 */
async function addFilms(token: string, listId: string, lids: string[], rejected: string[]): Promise<void> {
    if (lids.length === 0) return;

    const r = await patch(token, listId, { entries: lids.map((lid) => ({ action: 'ADD', film: lid })) });
    if (r.status !== 200) {
        throw new Error(`ADD batch of ${lids.length} failed: ${r.status} ${JSON.stringify(r.messages)}`);
    }

    const errors = errorMessages(r.messages);
    if (errors.length === 0) return;   // whole batch landed

    if (lids.length === 1) {
        // Isolated: this single film is the problem. Record and carry on.
        rejected.push(lids[0]);
        console.warn(`[lbx-list]   rejected film ${lids[0]}: ${errors.map((m) => `${m.code} ${m.title}`).join('; ')}`);
        if (rejected.length > MAX_REJECTED) {
            throw new Error(`too many rejected films (${rejected.length} > ${MAX_REJECTED}) — aborting rather than publishing a list with holes. Rejected: ${rejected.join(',')}`);
        }
        return;
    }

    const mid = Math.floor(lids.length / 2);
    await addFilms(token, listId, lids.slice(0, mid), rejected);
    await addFilms(token, listId, lids.slice(mid), rejected);
}

async function fetchTargetLids(network: NetworkKey): Promise<string[]> {
    const { rows } = await pool.query<{ letterboxd_id: string }>(
        `SELECT f.letterboxd_id
           FROM film_rankings_history frh
           JOIN films f ON f.film_id = frh.film_id
          WHERE frh.network = $1
            AND frh.week = (SELECT MAX(week) FROM film_rankings_history WHERE network = $1)
          ORDER BY frh.ranking ASC
          LIMIT 1000`,
        [network],
    );
    return rows.map((r) => r.letterboxd_id);
}

async function createListWithEntries(token: string, spec: NetworkSpec, target: string[]): Promise<string> {
    // POST /lists accepts up to 1000 entries in one shot — used the first time
    // a network's list is being created. Way faster than the PATCH dance.
    console.log(`[lbx-list] creating new list "${spec.listName}" with ${target.length} entries`);
    const r = await apiRequest('POST', token, '/lists', {}, {
        name: spec.listName,
        description: spec.description,
        published: true,
        ranked: true,
        entries: target.map((lid) => ({ film: lid })),
    });
    if (r.status !== 200) throw new Error(`create list failed: ${r.status} ${r.raw.slice(0, 400)}`);
    const data = r.parsed?.data as ListSummary | undefined;
    if (!data?.id) throw new Error(`create list returned no id: ${r.raw.slice(0, 400)}`);
    if (r.parsed?.messages?.length) {
        console.log(`[lbx-list] create messages: ${JSON.stringify(r.parsed.messages.slice(0, 5))}`);
    }
    console.log(`[lbx-list] created list id=${data.id} filmCount=${data.filmCount}`);
    return data.id;
}

export async function updateExistingList(token: string, listId: string, target: string[]): Promise<void> {
    const startSummary = await getListSummary(token, listId);
    console.log(`[lbx-list] list id=${listId} name="${startSummary.name}" filmCount=${startSummary.filmCount} version=${startSummary.version} published=${startSummary.published}`);

    const currentEntries = await fetchListEntries(token, listId);
    const currentLids = currentEntries.map((e) => e.film.id);
    console.log(`[lbx-list] fetched ${currentLids.length} current entries`);

    const identical = currentLids.length === target.length && currentLids.every((l, i) => l === target[i]);
    if (identical) {
        console.log('[lbx-list] list already matches target — nothing to do');
        // A prior failed run may have left it hidden; make sure it's public.
        if (!startSummary.published) {
            console.log('[lbx-list] list was unpublished — republishing');
            await setPublished(token, listId, true);
        }
        return;
    }

    // Unpublish for the duration of the rebuild so the public never sees the
    // list shrink and regrow. It 404s for everyone but the owner until we
    // republish at the end. rebuildOk gates the republish: on any failure we
    // deliberately leave it hidden rather than expose a half-built list.
    console.log('[lbx-list] unpublishing list for the rebuild (hidden from the public until done)');
    await setPublished(token, listId, false);
    let rebuildOk = false;
    try {
        await rebuildEntries(token, listId, currentLids, target);
        rebuildOk = true;
    } finally {
        if (rebuildOk) {
            await setPublished(token, listId, true);
            console.log('[lbx-list] rebuild verified — list republished');
        } else {
            console.error('[lbx-list] rebuild FAILED — leaving list UNPUBLISHED (hidden) so the public never sees a half-built list. Re-run this job to recover.');
        }
    }
}

async function rebuildEntries(token: string, listId: string, currentLids: string[], target: string[]): Promise<void> {
    // Phase A: shrink to 1 entry. DELETE position is 0-indexed, and many DELETE
    // actions batch into one PATCH — each removes the current top, so N of them
    // strip the top N. Verified safe by probing; cuts ~999 calls to ~10.
    let remaining = currentLids.length;
    console.log(`[lbx-list] phase A: shrinking ${remaining} -> 1 in batches of ${DELETE_BATCH}`);
    while (remaining > 1) {
        const n = Math.min(DELETE_BATCH, remaining - 1);
        const r = await patch(token, listId, { entries: Array.from({ length: n }, () => ({ action: 'DELETE', position: 0 })) });
        if (r.status !== 200) throw new Error(`phase A PATCH failed at remaining=${remaining}: ${r.status} ${JSON.stringify(r.messages)}`);
        remaining -= n;
    }
    let summary = await getListSummary(token, listId);
    console.log(`[lbx-list] phase A done. filmCount=${summary.filmCount}`);
    if (summary.filmCount !== 1) throw new Error(`phase A ended with filmCount=${summary.filmCount}, expected 1`);

    // Films Letterboxd refuses (retired IDs) are dropped from the target rather
    // than failing the run — see addFilms — and reported at the end.
    const rejected: string[] = [];

    // Phase B: ensure the single remaining entry is the first addable target.
    // Normally that's target[0]; if Letterboxd has retired it we walk forward,
    // since the list can't be emptied and something has to hold position 1.
    const after_a = await fetchListEntries(token, listId);
    const leftover = after_a[0]?.film.id;
    let head = target[0];
    if (leftover !== head) {
        let headIndex = 0;
        for (; headIndex < target.length; headIndex++) {
            const candidate = target[headIndex];
            const before = rejected.length;
            await addFilms(token, listId, [candidate], rejected);
            if (rejected.length === before) { head = candidate; break; }
            console.warn(`[lbx-list] phase B: target[${headIndex}] rejected, trying the next film for position 1`);
        }
        if (headIndex >= target.length) throw new Error('phase B: no target film could be added');
        console.log(`[lbx-list] phase B: replacing leftover LID=${leftover} with ${head}`);
        const r2 = await patch(token, listId, { entries: [{ action: 'DELETE', position: 0 }] });
        if (r2.status !== 200) throw new Error(`phase B del: ${r2.status} ${JSON.stringify(r2.messages)}`);
        const after_b = await fetchListEntries(token, listId);
        if (after_b.length !== 1 || after_b[0].film.id !== head) {
            throw new Error(`phase B left list in unexpected state: ${after_b.length} entries, top LID=${after_b[0]?.film.id}`);
        }
        console.log('[lbx-list] phase B done. list is now [head]');
    } else {
        console.log('[lbx-list] phase B: leftover already matches target[0], no-op');
    }

    // Phase C: bulk-ADD the rest, skipping anything already placed at the head.
    const toAdd = target.filter((lid) => lid !== head && !rejected.includes(lid));
    console.log(`[lbx-list] phase C: bulk-ADD ${toAdd.length} target films in batches of ${ADD_BATCH}`);
    for (let i = 0; i < toAdd.length; i += ADD_BATCH) {
        await addFilms(token, listId, toAdd.slice(i, i + ADD_BATCH), rejected);
        console.log(`[lbx-list]   phase C ${Math.min(i + ADD_BATCH, toAdd.length)}/${toAdd.length}`);
    }

    // Phase D: verify against the films Letterboxd actually accepted.
    const expected = target.filter((lid) => !rejected.includes(lid));
    if (rejected.length > 0) {
        console.warn(`[lbx-list] ${rejected.length} film(s) rejected by Letterboxd and dropped from the list: ${rejected.join(',')}`);
    }
    const final = await fetchListEntries(token, listId);
    const finalLids = final.map((e) => e.film.id);
    console.log(`[lbx-list] phase D: verifying. final filmCount=${finalLids.length}, expected=${expected.length}`);

    if (finalLids.length !== expected.length) {
        // Best-effort repair: append any missing films at the end.
        const missing = expected.filter((l) => !finalLids.includes(l));
        console.log(`[lbx-list]   ${missing.length} expected LIDs missing; appending`);
        await addFilms(token, listId, missing, rejected);
    }

    const final2 = await fetchListEntries(token, listId);
    const final2Lids = final2.map((e) => e.film.id);
    const expected2 = target.filter((lid) => !rejected.includes(lid));
    const mismatches: number[] = [];
    for (let i = 0; i < expected2.length; i++) if (final2Lids[i] !== expected2[i]) mismatches.push(i + 1);
    if (final2Lids.length !== expected2.length || mismatches.length > 0) {
        console.error(`[lbx-list] WARNING: final length=${final2Lids.length}, mismatches at ${mismatches.length} positions (first 10: ${mismatches.slice(0, 10).join(',')})`);
        throw new Error('list contents mismatch after update');
    }
    console.log(`[lbx-list] verified: all ${expected2.length} positions match target${rejected.length ? ` (${rejected.length} film(s) dropped as unknown to Letterboxd)` : ''}`);
}

function parseNetworkArg(): NetworkKey {
    const arg = (process.argv[2] || 'metro').toLowerCase();
    if (arg !== 'metro' && arg !== 'lank') {
        throw new Error(`usage: update-letterboxd-list [metro|lank]  (got: ${arg})`);
    }
    return arg;
}

async function main() {
    const t0 = Date.now();
    const network = parseNetworkArg();
    const spec = NETWORKS[network];
    console.log(`[lbx-list] start at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET — network=${network} list="${spec.listName}"`);

    const target = await fetchTargetLids(network);
    const week = (await pool.query<{ w: number }>(`SELECT MAX(week) AS w FROM film_rankings_history WHERE network = $1`, [network])).rows[0].w;
    console.log(`[lbx-list] target: ${target.length} LIDs from ${network} week ${week}`);
    if (target.length === 0) throw new Error(`no target LIDs for network=${network} — film_rankings_history empty?`);

    const token = await fetchAccessToken();
    console.log('[lbx-list] authed via refresh_token');

    let listId = await findListId(token, spec.listName);
    if (!listId) {
        listId = await createListWithEntries(token, spec, target);
    } else {
        await updateExistingList(token, listId, target);
    }

    const dur = Math.floor((Date.now() - t0) / 1000);
    console.log(`[lbx-list] SUCCESS: ${spec.listName} updated with ${target.length} entries in ${Math.floor(dur / 60)}m ${dur % 60}s`);
}

// Only run the job when invoked directly (node dist/scripts/update-letterboxd-list.js),
// so tests can import the functions above without firing a real list update.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[lbx-list] FATAL:', err);
            pool.end().finally(() => process.exit(1));
        });
}
