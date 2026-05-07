import fs from 'fs';
import path from 'path';
import pool from '../db/conn.js';
import { apiRequest, paginate } from './lbx-client.js';
import { downloadImage } from './download-image.js';

const SEED_USERNAME = 'metrodb';
const AVATAR_DIR = path.resolve('images/avatars');

interface LetterboxdImageSize {
    width: number;
    url: string;
}

interface LetterboxdMember {
    id?: string;
    username?: string;
    displayName?: string;
    avatar?: {
        sizes?: LetterboxdImageSize[];
    };
}

interface MemberSearchResponse {
    items?: Array<{ member?: LetterboxdMember }>;
}

async function resolveSeedLid(): Promise<string> {
    const j = await apiRequest<MemberSearchResponse>('GET', '/search', {
        query: { input: SEED_USERNAME, include: 'MemberSearchItem', searchMethod: 'Autocomplete', perPage: '1' },
    });
    const member = j.items?.[0]?.member;
    if (!member?.id) {
        throw new Error(`Could not resolve seed username "${SEED_USERNAME}" to a Letterboxd LID`);
    }
    return member.id;
}

function pickAvatarUrl(member: LetterboxdMember, preferLarge: boolean): string | null {
    const sizes = member?.avatar?.sizes;
    if (!Array.isArray(sizes) || sizes.length === 0) return null;
    return preferLarge
        ? sizes.reduce((b, s) => (s.width > b.width ? s : b)).url
        : sizes.reduce((b, s) => (s.width < b.width ? s : b)).url;
}

async function downloadAvatar(username: string, url: string, suffix = ''): Promise<void> {
    const dest = path.join(AVATAR_DIR, `${username}${suffix}.jpg`);
    try {
        fs.mkdirSync(AVATAR_DIR, { recursive: true });
        await downloadImage(url, dest);
    } catch (err) {
        console.warn(`[discover] avatar download failed for ${username}${suffix}: ${err.message}`);
    }
}

async function upsertMember(member: LetterboxdMember): Promise<void> {
    const username = String(member.username || '').toLowerCase();
    const displayName = member.displayName || member.username || '';
    await pool.query(
        `INSERT INTO users_stg (letterboxd_id, username, display_name, num_films_watched, time_created, time_modified)
         VALUES ($1, $2, $3, NULL, NOW(), NOW())
         ON CONFLICT (letterboxd_id) DO UPDATE
            SET username = EXCLUDED.username,
                display_name = EXCLUDED.display_name,
                time_modified = NOW()`,
        [member.id, username, displayName],
    );

    const smallUrl = pickAvatarUrl(member, false);
    const largeUrl = pickAvatarUrl(member, true);
    if (smallUrl) await downloadAvatar(username, smallUrl);
    if (largeUrl) await downloadAvatar(username, largeUrl, '-large');
}

export async function discoverMembers(): Promise<number> {
    const seedLid = await resolveSeedLid();
    console.log(`[discover] seed ${SEED_USERNAME} -> ${seedLid}`);

    let count = 0;
    for await (const member of paginate<LetterboxdMember>('/members', { member: seedLid, memberRelationship: 'IsFollowing', perPage: '100' })) {
        if (!member?.id || !member?.username) continue;
        await upsertMember(member);
        count++;
        if (count % 50 === 0) console.log(`[discover] ingested ${count} members so far`);
    }
    console.log(`[discover] done: ${count} members in users_stg`);
    return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    discoverMembers()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[discover] fatal:', err);
            process.exit(1);
        });
}
