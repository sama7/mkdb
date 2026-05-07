type JsonObject = Record<string, any>;

const baseUrl = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function getJson<T>(path: string, expectedStatus = 200): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`);
    const contentType = response.headers.get('content-type') || '';
    if (response.status !== expectedStatus) {
        throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
    }
    if (!contentType.includes('application/json')) {
        throw new Error(`${path} returned ${contentType || 'no content-type'}, expected JSON`);
    }
    return await response.json() as T;
}

async function getBinary(path: string, expectedStatus = 200): Promise<Response> {
    const response = await fetch(`${baseUrl}${path}`);
    if (response.status !== expectedStatus) {
        throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}`);
    }
    await response.arrayBuffer();
    return response;
}

function assertArray(name: string, value: unknown): asserts value is JsonObject[] {
    if (!Array.isArray(value)) {
        throw new Error(`${name} did not return an array`);
    }
}

function assertObject(name: string, value: unknown): asserts value is JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} did not return an object`);
    }
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
    await fn();
    console.log(`[smoke] PASS ${name}`);
}

async function main(): Promise<void> {
    console.log(`[smoke] base=${baseUrl}`);

    let firstSlug = '';
    let firstUsername = '';
    let neighborUsername = '';

    await check('/api/rankings', async () => {
        const rows = await getJson<JsonObject[]>('/api/rankings?limit=1');
        assertArray('/api/rankings', rows);
        if (!rows[0]?.slug) throw new Error('/api/rankings did not include a slug');
        firstSlug = String(rows[0].slug);
    });

    await check('/api/evil-mank', async () => {
        assertArray('/api/evil-mank', await getJson('/api/evil-mank?limit=1'));
    });

    for (const path of ['/api/risers', '/api/fallers', '/api/new-entries', '/api/new-departures']) {
        await check(path, async () => {
            assertArray(path, await getJson(path));
        });
    }

    await check('/api/film/:slug', async () => {
        const payload = await getJson<JsonObject>(`/api/film/${encodeURIComponent(firstSlug)}`);
        assertObject('/api/film/:slug', payload);
        assertObject('/api/film/:slug film', payload.film);
        assertArray('/api/film/:slug ratings', payload.ratings);
    });

    await check('/api/members', async () => {
        const rows = await getJson<JsonObject[]>('/api/members?limit=1');
        assertArray('/api/members', rows);
        if (!rows[0]?.username) throw new Error('/api/members did not include a username');
        firstUsername = String(rows[0].username);
    });

    await check('/api/members/:username', async () => {
        assertObject('/api/members/:username', await getJson(`/api/members/${encodeURIComponent(firstUsername)}`));
    });

    await check('/api/member/:username', async () => {
        const rows = await getJson<JsonObject[]>(`/api/member/${encodeURIComponent(firstUsername)}?limit=1`);
        assertArray('/api/member/:username', rows);
        if (rows[0]?.neighbor_username) neighborUsername = String(rows[0].neighbor_username);
    });

    if (neighborUsername) {
        await check('/api/neighbors/:a/:b', async () => {
            assertObject('/api/neighbors/:a/:b', await getJson(`/api/neighbors/${encodeURIComponent(firstUsername)}/${encodeURIComponent(neighborUsername)}`));
        });

        for (const path of ['neighbors-agreed', 'neighbors-differ']) {
            await check(`/api/${path}/:a/:b`, async () => {
                assertArray(`/api/${path}/:a/:b`, await getJson(`/api/${path}/${encodeURIComponent(firstUsername)}/${encodeURIComponent(neighborUsername)}?limit=1`));
            });
        }
    } else {
        console.log('[smoke] SKIP neighbor pair checks; first member had no neighbor rows');
    }

    await check('/api/discord/films/rank/:rank', async () => {
        const payload = await getJson<JsonObject>('/api/discord/films/rank/1');
        assertObject('/api/discord/films/rank/:rank', payload);
        assertObject('/api/discord/films/rank/:rank film', payload.film);
    });

    await check('/api/discord/films/nearmank/:rank', async () => {
        const payload = await getJson<JsonObject>('/api/discord/films/nearmank/1');
        assertObject('/api/discord/films/nearmank/:rank', payload);
        assertObject('/api/discord/films/nearmank/:rank film', payload.film);
    });

    await check('/api/discord/posters-grid', async () => {
        const response = await getBinary(`/api/discord/posters-grid?slugs=${encodeURIComponent(firstSlug)}`);
        if (!(response.headers.get('content-type') || '').includes('image/jpeg')) {
            throw new Error('/api/discord/posters-grid did not return image/jpeg');
        }
    });
}

main().catch((error) => {
    console.error('[smoke] FAIL', error);
    process.exit(1);
});
