import crypto from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import 'dotenv/config';

const BASE_URL = 'https://api.letterboxd.com/api/v0';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_INTERVAL_MS = 500; // 2 req/sec — polite for an authorized API client

// Node's fetch has no default timeout, so a Letterboxd call that stalls would
// hang forever. Every attempt is bounded by an AbortSignal instead. The batch
// default is generous; interactive callers pass a tighter budget (see below).
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 5;

/**
 * Retry/timeout budget for the interactive Discord commands, which sit behind a
 * user staring at "thinking…". A healthy Letterboxd call returns in well under
 * a second, so 5s per attempt means "effectively dead", and 2 retries recovers
 * a transient network blip (the ECONNRESET that surfaced as "Server error while
 * searching") in ~1.5s. Worst case — Letterboxd fully unresponsive — is bounded
 * at roughly 3×5s plus backoff, then a clean error, rather than an endless spin.
 * Batch jobs keep the generous defaults above.
 */
export const INTERACTIVE_LBX: Pick<ApiRequestOptions, 'maxRetries' | 'timeoutMs'> = {
    maxRetries: 2,
    timeoutMs: 5000,
};

/** True for errors worth retrying: a thrown fetch failure or an abort/timeout. */
function isTransientNetworkError(err: unknown): boolean {
    // Only network conditions reach the catch sites that call this: fetch()
    // rejects with a TypeError ("fetch failed") on socket/TLS/DNS failures, and
    // AbortSignal.timeout rejects with a DOMException named "TimeoutError". HTTP
    // status errors are handled separately via res.status and never thrown here.
    // We check name/DOMException explicitly rather than lean on `instanceof
    // Error`, which has varied for DOMException across Node versions.
    if (err instanceof Error) return true;
    if (typeof DOMException !== 'undefined' && err instanceof DOMException) return true;
    const name = (err as { name?: string })?.name;
    return name === 'TimeoutError' || name === 'AbortError';
}

const CLIENT_ID = process.env.LETTERBOXD_CLIENT_ID;
const CLIENT_SECRET = process.env.LETTERBOXD_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('LETTERBOXD_CLIENT_ID and LETTERBOXD_CLIENT_SECRET must be set in .env');
}
// Re-bind to fresh consts so TypeScript carries the narrowed `string` type
// past the throw — the original module-level lets are still `string | undefined`.
const REQUIRED_CLIENT_ID = CLIENT_ID;
const REQUIRED_CLIENT_SECRET = CLIENT_SECRET;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type ApiQueryValue = string | number | boolean | null | undefined;
export type ApiQuery = Record<string, ApiQueryValue>;
type ApiBody = string | Record<string, unknown> | null;
interface ApiRequestOptions {
    query?: ApiQuery;
    body?: ApiBody;
    intervalMs?: number;
    maxRetries?: number;
    /** Per-attempt timeout in ms (AbortSignal). Defaults to DEFAULT_TIMEOUT_MS. */
    timeoutMs?: number;
}
interface CachedToken {
    token: string;
    expiresAt: number;
}
interface TokenResponse {
    access_token: string;
    expires_in: number;
}
type ApiError = Error & {
    status?: number;
    body?: string;
};

let nextSlot = 0;
let inflight = Promise.resolve();

async function throttle(intervalMs: number): Promise<void> {
    inflight = inflight.then(async () => {
        const now = Date.now();
        const wait = Math.max(0, nextSlot - now);
        if (wait > 0) await sleep(wait);
        nextSlot = Math.max(now, nextSlot) + intervalMs;
    });
    return inflight;
}

function buildSignedUrl(method: HttpMethod, path: string, query: ApiQuery | null | undefined, body: string) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value != null) q.set(key, String(value));
    }
    q.set('apikey', REQUIRED_CLIENT_ID);
    q.set('nonce', crypto.randomUUID());
    q.set('timestamp', String(Math.floor(Date.now() / 1000)));
    const url = `${BASE_URL}${path}?${q.toString()}`;
    const message = `${method}\0${url}\0${body ?? ''}`;
    const signature = crypto.createHmac('sha256', REQUIRED_CLIENT_SECRET).update(message).digest('hex');
    return { url, signature };
}

let cachedToken: CachedToken | null = null;

async function fetchToken(timeoutMs: number): Promise<CachedToken> {
    const body = 'grant_type=client_credentials';
    const { url, signature } = buildSignedUrl('POST', '/auth/token', null, body);
    const res = await fetch(url, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs),
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
    const j = await res.json() as TokenResponse;
    return {
        token: j.access_token,
        expiresAt: Date.now() + (j.expires_in - 300) * 1000,
    };
}

async function getToken(timeoutMs: number): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
    cachedToken = await fetchToken(timeoutMs);
    return cachedToken.token;
}

export async function apiRequest<T = any>(method: HttpMethod, path: string, { query, body, intervalMs = DEFAULT_INTERVAL_MS, maxRetries = DEFAULT_MAX_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS }: ApiRequestOptions = {}): Promise<T> {
    const bodyStr = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await throttle(intervalMs);
        const { url, signature } = buildSignedUrl(method, path, query, bodyStr);

        // The token fetch and the request itself are the network operations, so
        // they share the retry: a socket reset or a per-attempt timeout on
        // either is retried like a 5xx instead of failing the whole call. This
        // is the fix for the ECONNRESET that surfaced as "Server error while
        // searching" — a single transient blip no longer aborts the command.
        let res: Response;
        try {
            const token = await getToken(timeoutMs);
            res = await fetch(url, {
                method,
                body: bodyStr || undefined,
                signal: AbortSignal.timeout(timeoutMs),
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Signature': signature,
                    'User-Agent': USER_AGENT,
                    Accept: 'application/json',
                    ...(bodyStr && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
                    ...(bodyStr && typeof body === 'string' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
                },
            });
        } catch (err) {
            if (isTransientNetworkError(err) && attempt < maxRetries) {
                const backoff = Math.min(2000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
                console.warn(`[lbx] network error on ${method} ${path} (${(err as Error).message}), retry in ${backoff}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                await sleep(backoff);
                continue;
            }
            throw new Error(`API ${method} ${path} network failure after ${attempt + 1} attempt(s): ${(err as Error).message}`, { cause: err });
        }

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

        // Reading the body can also fail mid-stream on a disconnect; treat that
        // like any other transient network error rather than letting it escape.
        let text: string;
        try {
            text = await res.text();
        } catch (err) {
            if (isTransientNetworkError(err) && attempt < maxRetries) {
                const backoff = Math.min(2000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
                console.warn(`[lbx] body read failed on ${method} ${path} (${(err as Error).message}), retry in ${backoff}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                await sleep(backoff);
                continue;
            }
            throw new Error(`API ${method} ${path} body read failure after ${attempt + 1} attempt(s): ${(err as Error).message}`, { cause: err });
        }

        if (!res.ok) {
            const err: ApiError = new Error(`API ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
            err.status = res.status;
            err.body = text;
            throw err;
        }
        return text ? JSON.parse(text) as T : null as T;
    }
    throw new Error(`API ${method} ${path} failed after ${maxRetries} retries`);
}

export async function* paginate<T = any>(path: string, query: ApiQuery, opts: Omit<ApiRequestOptions, 'query'> = {}): AsyncGenerator<T> {
    const perPage = Number(query?.perPage ?? 100);
    let cursor: string | null = null;
    while (true) {
        const q: ApiQuery = cursor ? { ...query, cursor } : { ...query };
        const page: { items?: T[]; next?: string } = await apiRequest<{ items?: T[]; next?: string }>('GET', path, { ...opts, query: q });
        const items = page.items || [];
        for (const item of items) yield item;
        if (!page.next || items.length === 0 || items.length < perPage) break;
        cursor = page.next;
    }
}
