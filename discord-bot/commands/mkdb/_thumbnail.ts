import 'dotenv/config';
import { AttachmentBuilder } from 'discord.js';

// In dev, MKDB_BASE_URL points at the Vite dev server (localhost:5173) which
// proxies /images/* to Node on :3000, so this URL works without any special
// handling. In prod, MKDB_BASE_URL is mkdb.co and nginx routes it to Node.
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';

export interface ThumbAttachment {
    attachment: AttachmentBuilder;
    thumbnailUrl: string;   // attachment://thumb-<slug>.<ext>
}

/**
 * Fetch a film's thumbnail bytes from the MKDb server and wrap them in an
 * AttachmentBuilder so the embed can reference them via `attachment://`.
 * Lets the bot show real posters and the simple Discord placeholder without
 * relying on Discord being able to reach the URL — so this works against a
 * localhost server in dev, where the prod URL isn't yet up to date.
 *
 * Returns null if the fetch fails so the caller can fall back to an embed
 * with no thumbnail rather than throwing.
 */
export async function fetchThumbAttachment(slug: string): Promise<ThumbAttachment | null> {
    try {
        const res = await fetch(`${MKDB_BASE_URL}/images/discord-thumb/${slug}.jpg`);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = res.headers.get('content-type') === 'image/png' ? 'png' : 'jpg';
        const name = `thumb-${slug}.${ext}`;
        return {
            attachment: new AttachmentBuilder(buf, { name }),
            thumbnailUrl: `attachment://${name}`,
        };
    } catch {
        return null;
    }
}
