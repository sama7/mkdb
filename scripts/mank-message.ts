/**
 * Ad-hoc message management for the #mank channel, as the bot.
 *
 * scripts/post-weekly-update.ts covers the scheduled weekly post. This is for
 * the occasional out-of-band message that goes with it — a note explaining a
 * correction, or removing a post whose data turned out to be wrong.
 *
 * Auth is DISCORD_TOKEN, the same bot token the weekly post uses. A bot can
 * always delete its own messages, so no extra permission is needed for the
 * posts this project makes.
 *
 *   node dist/scripts/mank-message.js post "some text"
 *   node dist/scripts/mank-message.js delete <messageId>
 */
import 'dotenv/config';
import '../lib/log-timestamps.js';

const CHANNEL_ID = process.env.MANK_CHANNEL_ID || '1286092918762770462';
const TOKEN = process.env.DISCORD_TOKEN;
const API = 'https://discord.com/api/v10';

function requireToken(): string {
    if (!TOKEN) throw new Error('DISCORD_TOKEN must be set');
    return TOKEN;
}

async function postMessage(content: string): Promise<string> {
    const res = await fetch(`${API}/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${requireToken()}`, 'Content-Type': 'application/json' },
        // allowed_mentions parse:[] so a stray @ in the text can never ping the
        // channel — these are informational notes, not announcements.
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`Discord POST failed: ${res.status} ${await res.text()}`);
    const msg = await res.json() as { id: string };
    console.log(`[mank-message] posted ${msg.id} to channel ${CHANNEL_ID}`);
    return msg.id;
}

async function deleteMessage(messageId: string): Promise<void> {
    const res = await fetch(`${API}/channels/${CHANNEL_ID}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${requireToken()}` },
    });
    // 204 is the success case; 404 means it is already gone, which is the
    // outcome we wanted anyway.
    if (res.status === 404) {
        console.log(`[mank-message] ${messageId} not found — already deleted`);
        return;
    }
    if (!res.ok) throw new Error(`Discord DELETE failed: ${res.status} ${await res.text()}`);
    console.log(`[mank-message] deleted ${messageId} from channel ${CHANNEL_ID}`);
}

async function main() {
    const [action, ...rest] = process.argv.slice(2);
    if (action === 'post') {
        const content = rest.join(' ').trim();
        if (!content) throw new Error('post needs message text');
        await postMessage(content);
    } else if (action === 'delete') {
        const id = rest[0];
        if (!id) throw new Error('delete needs a message id');
        await deleteMessage(id);
    } else {
        throw new Error(`unknown action "${action ?? ''}" — expected "post" or "delete"`);
    }
}

main().catch((err) => {
    console.error('[mank-message] fatal:', err.message);
    process.exit(1);
});
