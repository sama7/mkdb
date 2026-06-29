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
//   Phase A: shrink to 1 entry via DELETE pos=0 in a loop (~999 PATCHes)
//   Phase B: if leftover != target[0], replace it (ADD target[0], DELETE pos=0)
//   Phase C: bulk-ADD target[1..999] in batches of 100
//   Phase D: refetch, verify all 1000 positions match target

import 'dotenv/config';
import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import pool from '../db/conn.js';

const BASE = 'https://api.letterboxd.com/api/v0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const THROTTLE_MS = 350;
const ADD_BATCH = 100;

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

async function fetchAccessToken(): Promise<string> {
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

interface ListSummary { id: string; name: string; filmCount: number; version: number }
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

async function updateExistingList(token: string, listId: string, target: string[]): Promise<void> {
    const startSummary = await getListSummary(token, listId);
    console.log(`[lbx-list] list id=${listId} name="${startSummary.name}" filmCount=${startSummary.filmCount} version=${startSummary.version}`);

    const currentEntries = await fetchListEntries(token, listId);
    const currentLids = currentEntries.map((e) => e.film.id);
    console.log(`[lbx-list] fetched ${currentLids.length} current entries`);

    const identical = currentLids.length === target.length && currentLids.every((l, i) => l === target[i]);
    if (identical) {
        console.log('[lbx-list] list already matches target — nothing to do');
        return;
    }

    // Phase A: shrink to 1 entry. DELETE position is 0-indexed.
    const toDelete = currentLids.length - 1;
    console.log(`[lbx-list] phase A: deleting ${toDelete} top entries (position=0 each iteration)`);
    for (let i = 0; i < toDelete; i++) {
        const r = await patch(token, listId, { entries: [{ action: 'DELETE', position: 0 }] });
        if (r.status !== 200) throw new Error(`phase A PATCH failed at iter ${i}: ${r.status} ${JSON.stringify(r.messages)}`);
        if ((i + 1) % 100 === 0) console.log(`[lbx-list]   phase A ${i + 1}/${toDelete}`);
    }
    let summary = await getListSummary(token, listId);
    console.log(`[lbx-list] phase A done. filmCount=${summary.filmCount}`);
    if (summary.filmCount !== 1) throw new Error(`phase A ended with filmCount=${summary.filmCount}, expected 1`);

    // Phase B: ensure the single remaining entry is target[0].
    const after_a = await fetchListEntries(token, listId);
    const leftover = after_a[0]?.film.id;
    if (leftover !== target[0]) {
        console.log(`[lbx-list] phase B: leftover LID=${leftover} != target[0]=${target[0]} — replacing`);
        const r1 = await patch(token, listId, { entries: [{ action: 'ADD', film: target[0] }] });
        if (r1.status !== 200) throw new Error(`phase B add: ${r1.status} ${JSON.stringify(r1.messages)}`);
        const r2 = await patch(token, listId, { entries: [{ action: 'DELETE', position: 0 }] });
        if (r2.status !== 200) throw new Error(`phase B del: ${r2.status} ${JSON.stringify(r2.messages)}`);
        const after_b = await fetchListEntries(token, listId);
        if (after_b.length !== 1 || after_b[0].film.id !== target[0]) {
            throw new Error(`phase B left list in unexpected state: ${after_b.length} entries, top LID=${after_b[0]?.film.id}`);
        }
        console.log('[lbx-list] phase B done. list is now [target[0]]');
    } else {
        console.log('[lbx-list] phase B: leftover already matches target[0], no-op');
    }

    // Phase C: bulk-ADD target[1..999] in batches.
    const toAdd = target.slice(1);
    console.log(`[lbx-list] phase C: bulk-ADD ${toAdd.length} target films in batches of ${ADD_BATCH}`);
    for (let i = 0; i < toAdd.length; i += ADD_BATCH) {
        const batch = toAdd.slice(i, i + ADD_BATCH);
        const r = await patch(token, listId, { entries: batch.map((lid) => ({ action: 'ADD', film: lid })) });
        if (r.status !== 200) throw new Error(`phase C PATCH failed at offset ${i + 1}: ${r.status} ${JSON.stringify(r.messages)}`);
        if (r.messages?.length) {
            const sample = r.messages.slice(0, 3).map((m) => `${m.code}:${m.title}`).join('; ');
            console.log(`[lbx-list]   batch ${Math.floor(i / ADD_BATCH) + 1}: ${r.messages.length} message(s): ${sample}`);
        }
        console.log(`[lbx-list]   phase C added ${Math.min(i + ADD_BATCH, toAdd.length) + 1}/${target.length}`);
    }

    // Phase D: verify
    const final = await fetchListEntries(token, listId);
    const finalLids = final.map((e) => e.film.id);
    console.log(`[lbx-list] phase D: verifying. final filmCount=${finalLids.length}, target=${target.length}`);

    if (finalLids.length !== target.length) {
        // Best-effort repair: append any missing target films at the end.
        const missing = target.filter((l) => !finalLids.includes(l));
        console.log(`[lbx-list]   ${missing.length} target LIDs missing; appending`);
        if (missing.length > 0) {
            const r = await patch(token, listId, { entries: missing.map((lid) => ({ action: 'ADD', film: lid })) });
            if (r.status !== 200) console.log(`   add-missing failed: ${r.status}`);
            if (r.messages?.length) console.log(`   add-missing messages: ${JSON.stringify(r.messages.slice(0, 3))}`);
        }
    }

    const final2 = await fetchListEntries(token, listId);
    const final2Lids = final2.map((e) => e.film.id);
    const mismatches: number[] = [];
    for (let i = 0; i < target.length; i++) if (final2Lids[i] !== target[i]) mismatches.push(i + 1);
    if (final2Lids.length !== target.length || mismatches.length > 0) {
        console.error(`[lbx-list] WARNING: final length=${final2Lids.length}, mismatches at ${mismatches.length} positions (first 10: ${mismatches.slice(0, 10).join(',')})`);
        throw new Error('list contents mismatch after update');
    }
    console.log(`[lbx-list] verified: all ${target.length} positions match target`);
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

main()
    .then(() => pool.end())
    .catch((err) => {
        console.error('[lbx-list] FATAL:', err);
        pool.end().finally(() => process.exit(1));
    });
