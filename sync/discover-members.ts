import fs from 'fs';
import path from 'path';
import pool from '../db/conn.js';
import { apiRequest, paginate } from './lbx-client.js';
import { downloadImage } from './download-image.js';

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

export interface DiscoverOpts {
    seed: string;          // Letterboxd username of the account whose follows we ingest
    isMetro?: boolean;     // mark each ingested member with is_metro = true
    isLycan?: boolean;     // mark each ingested member with is_lycan = true
}

async function resolveSeedLid(username: string): Promise<string> {
    const j = await apiRequest<MemberSearchResponse>('GET', '/search', {
        query: { input: username, include: 'MemberSearchItem', searchMethod: 'Autocomplete', perPage: '1' },
    });
    const member = j.items?.[0]?.member;
    if (!member?.id) {
        throw new Error(`Could not resolve seed username "${username}" to a Letterboxd LID`);
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

async function upsertMember(member: LetterboxdMember, isMetro: boolean, isLycan: boolean): Promise<void> {
    const username = String(member.username || '').toLowerCase();
    const displayName = member.displayName || member.username || '';

    // OR-merge the network flags on conflict: if the same user appears in
    // both metrodb's and lycandb's follows (current overlap: 25 users), the
    // first discover call sets one flag, the second OR-merges the other.
    await pool.query(
        `INSERT INTO users_stg (letterboxd_id, username, display_name, num_films_watched, is_metro, is_lycan, time_created, time_modified)
         VALUES ($1, $2, $3, NULL, $4, $5, NOW(), NOW())
         ON CONFLICT (letterboxd_id) DO UPDATE
            SET username      = EXCLUDED.username,
                display_name  = EXCLUDED.display_name,
                is_metro      = users_stg.is_metro OR EXCLUDED.is_metro,
                is_lycan      = users_stg.is_lycan OR EXCLUDED.is_lycan,
                time_modified = NOW()`,
        [member.id, username, displayName, isMetro, isLycan],
    );

    const smallUrl = pickAvatarUrl(member, false);
    const largeUrl = pickAvatarUrl(member, true);
    if (smallUrl) await downloadAvatar(username, smallUrl);
    if (largeUrl) await downloadAvatar(username, largeUrl, '-large');
}

export async function discoverMembers(opts: DiscoverOpts): Promise<number> {
    const { seed, isMetro = false, isLycan = false } = opts;
    if (!isMetro && !isLycan) {
        throw new Error(`discoverMembers({ seed: "${seed}" }) needs at least one of isMetro / isLycan`);
    }

    const seedLid = await resolveSeedLid(seed);
    const flags = [isMetro && 'metro', isLycan && 'lycan'].filter(Boolean).join('+');
    console.log(`[discover] seed ${seed} -> ${seedLid} (flags: ${flags})`);

    let count = 0;
    for await (const member of paginate<LetterboxdMember>('/members', { member: seedLid, memberRelationship: 'IsFollowing', perPage: '100' })) {
        if (!member?.id || !member?.username) continue;
        await upsertMember(member, isMetro, isLycan);
        count++;
        if (count % 50 === 0) console.log(`[discover] ${seed}: ingested ${count} members so far`);
    }
    console.log(`[discover] ${seed} done: ${count} members upserted into users_stg`);
    return count;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    // CLI entry retained for ad-hoc runs of just the metro discover step.
    discoverMembers({ seed: 'metrodb', isMetro: true })
        .then(() => pool.end())
        .catch((err) => {
            console.error('[discover] fatal:', err);
            process.exit(1);
        });
}
