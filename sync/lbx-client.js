import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import 'dotenv/config';

const BASE_URL = 'https://api.letterboxd.com/api/v0';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_INTERVAL_MS = 500; // 2 req/sec — polite for an authorized API client

const CLIENT_ID = process.env.LETTERBOXD_CLIENT_ID;
const CLIENT_SECRET = process.env.LETTERBOXD_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('LETTERBOXD_CLIENT_ID and LETTERBOXD_CLIENT_SECRET must be set in .env');
}

let nextSlot = 0;
let inflight = Promise.resolve();

async function throttle(intervalMs) {
    inflight = inflight.then(async () => {
        const now = Date.now();
        const wait = Math.max(0, nextSlot - now);
        if (wait > 0) await sleep(wait);
        nextSlot = Math.max(now, nextSlot) + intervalMs;
    });
    return inflight;
}

function buildSignedUrl(method, path, query, body) {
    const q = new URLSearchParams(query || {});
    q.set('apikey', CLIENT_ID);
    q.set('nonce', crypto.randomUUID());
    q.set('timestamp', String(Math.floor(Date.now() / 1000)));
    const url = `${BASE_URL}${path}?${q.toString()}`;
    const message = `${method}\0${url}\0${body ?? ''}`;
    const signature = crypto.createHmac('sha256', CLIENT_SECRET).update(message).digest('hex');
    return { url, signature };
}

let cachedToken = null;

async function fetchToken() {
    const body = 'grant_type=client_credentials';
    const { url, signature } = buildSignedUrl('POST', '/auth/token', null, body);
    const res = await fetch(url, {
        method: 'POST',
        body,
        headers: {
            Authorization: `Signature ${signature}`,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
    }
    const j = await res.json();
    return {
        token: j.access_token,
        expiresAt: Date.now() + (j.expires_in - 300) * 1000,
    };
}

async function getToken() {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
    cachedToken = await fetchToken();
    return cachedToken.token;
}

export async function apiRequest(method, path, { query, body, intervalMs = DEFAULT_INTERVAL_MS, maxRetries = 5 } = {}) {
    const bodyStr = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await throttle(intervalMs);
        const { url, signature } = buildSignedUrl(method, path, query, bodyStr);
        const token = await getToken();

        const res = await fetch(url, {
            method,
            body: bodyStr || undefined,
            headers: {
                Authorization: `Bearer ${token}`,
                'X-Signature': signature,
                'User-Agent': USER_AGENT,
                Accept: 'application/json',
                ...(bodyStr && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
                ...(bodyStr && typeof body === 'string' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            },
        });

        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('retry-after')) || 30;
            console.warn(`[lbx] 429, sleeping ${retryAfter}s (attempt ${attempt + 1})`);
            await sleep(retryAfter * 1000);
            continue;
        }
        if (res.status >= 500 && attempt < maxRetries) {
            const backoff = Math.min(60_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 500);
            console.warn(`[lbx] ${res.status} on ${method} ${path}, backing off ${backoff}ms`);
            await sleep(backoff);
            continue;
        }
        if (res.status === 401 && attempt < maxRetries) {
            cachedToken = null;
            continue;
        }

        const text = await res.text();
        if (!res.ok) {
            const err = new Error(`API ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
            err.status = res.status;
            err.body = text;
            throw err;
        }
        return text ? JSON.parse(text) : null;
    }
    throw new Error(`API ${method} ${path} failed after ${maxRetries} retries`);
}

export async function* paginate(path, query, opts = {}) {
    const perPage = Number(query?.perPage ?? 100);
    let cursor = null;
    while (true) {
        const q = cursor ? { ...query, cursor } : { ...query };
        const page = await apiRequest('GET', path, { ...opts, query: q });
        const items = page.items || [];
        for (const item of items) yield item;
        if (!page.next || items.length === 0 || items.length < perPage) break;
        cursor = page.next;
    }
}
