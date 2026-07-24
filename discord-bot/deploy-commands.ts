import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REST, Routes } from 'discord.js';

import type { MkdbCommand } from './commands/types.js';
import type { Network } from './commands/mkdb/_brand.js';

const clientId = process.env.clientId;
const token = process.env.DISCORD_TOKEN;

// Collect every env var whose name starts with `guildId` (case-insensitive).
// The suffix selects which network's command that guild gets: `guildIdMetro`
// registers /mkdb, `guildIdLycan` registers /lkdb. A bare `guildId=...` (the
// local dev server) gets both so either can be tested. Deduplicate by guild
// id so a stray duplicate value won't double-register.
const NETWORK_BY_SUFFIX: Record<string, Network> = { metro: 'metro', lycan: 'lank', lank: 'lank' };

const guildTargets = new Map<string, Network | null>();
for (const [key, value] of Object.entries(process.env)) {
    if (!/^guildId/i.test(key) || typeof value !== 'string' || !value.trim()) continue;
    const suffix = key.slice('guildId'.length).toLowerCase();
    // An unrecognized suffix falls back to "everything" rather than silently
    // registering nothing, which would look like a broken deploy.
    guildTargets.set(value.trim(), NETWORK_BY_SUFFIX[suffix] ?? null);
}
const guildIds = [...guildTargets.keys()];

if (!token) throw new Error('Missing DISCORD_TOKEN in your .env');
if (!clientId) throw new Error('Missing clientId in your .env');
if (guildIds.length === 0) throw new Error('Missing guildId in your .env (use guildId=... for one guild, or guildIdName=... entries for multiple)');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Kept as whole commands (not just their JSON) so each can be matched to the
// guilds that should receive it by network.
const commands: MkdbCommand[] = [];
const foldersPath = join(__dirname, 'commands');
const commandFolders = readdirSync(foldersPath);

for (const folder of commandFolders) {
    // Only register the router file (index.js) in each command folder.
    // Sibling files (e.g. commands/types.js, commands/mkdb/_contributor.js)
    // are not commands. Skipping anything without an index.js naturally
    // excludes non-directory entries too.
    const indexPath = join(foldersPath, folder, 'index.js');
    if (!existsSync(indexPath)) continue;

    const mod = await import(pathToFileURL(indexPath).href);
    const exported = mod.default as Partial<MkdbCommand>[] | Partial<MkdbCommand> | undefined;

    for (const command of Array.isArray(exported) ? exported : [exported]) {
        if (command?.data && command?.execute && command?.brand) {
            commands.push(command as MkdbCommand);
        } else {
            console.log(`[WARNING] The command at ${indexPath} is missing a required "data", "execute" or "brand" property.`);
        }
    }
}

const rest = new REST().setToken(token);

console.log(`Started refreshing application (/) commands across ${guildIds.length} guild(s).`);

// PUT replaces the full command set for each guild. We do this one guild at
// a time rather than Promise.all so a Discord rate-limit on one guild doesn't
// mask the success/failure of the others.
for (const [guildId, network] of guildTargets) {
    // A guild only ever sees its own network's command, so the Metropolis
    // server can't accidentally be handed /lkdb (or vice versa).
    const forGuild = commands.filter((c) => network === null || c.brand.network === network);
    const names = forGuild.map((c) => `/${c.data.name}`).join(', ') || 'none';
    try {
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: forGuild.map((c) => c.data.toJSON()) },
        );
        const refreshedCount = Array.isArray(data) ? data.length : 0;
        console.log(`  guild ${guildId}: reloaded ${refreshedCount} command(s) — ${names}`);
    } catch (error) {
        console.error(`  guild ${guildId}: failed to deploy`, error);
    }
}
