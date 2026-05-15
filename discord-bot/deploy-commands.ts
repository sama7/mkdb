import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REST, Routes } from 'discord.js';

import type { MkdbCommand } from './commands/types.js';

const clientId = process.env.clientId;
const token = process.env.DISCORD_TOKEN;

// Collect every env var whose name starts with `guildId` (case-insensitive).
// Lets local use a single `guildId=...` while prod uses any number of named
// variants like `guildIdMetro=...`, `guildIdLycan=...` — the deploy step PUTs
// the same command set to each. Deduplicate so a stray duplicate value won't
// double-register.
const guildIds = [...new Set(
    Object.entries(process.env)
        .filter(([k, v]) => /^guildId/i.test(k) && typeof v === 'string' && v.trim().length > 0)
        .map(([, v]) => v!.trim()),
)];

if (!token) throw new Error('Missing DISCORD_TOKEN in your .env');
if (!clientId) throw new Error('Missing clientId in your .env');
if (guildIds.length === 0) throw new Error('Missing guildId in your .env (use guildId=... for one guild, or guildIdName=... entries for multiple)');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands: ReturnType<MkdbCommand['data']['toJSON']>[] = [];
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
    const command = mod.default as Partial<MkdbCommand> | undefined;

    if (command?.data && command?.execute) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[WARNING] The command at ${indexPath} is missing a required "data" or "execute" property.`);
    }
}

const rest = new REST().setToken(token);

console.log(`Started refreshing ${commands.length} application (/) commands across ${guildIds.length} guild(s).`);

// PUT replaces the full command set for each guild. We do this one guild at
// a time rather than Promise.all so a Discord rate-limit on one guild doesn't
// mask the success/failure of the others.
for (const guildId of guildIds) {
    try {
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
        const refreshedCount = Array.isArray(data) ? data.length : 0;
        console.log(`  guild ${guildId}: reloaded ${refreshedCount} command(s).`);
    } catch (error) {
        console.error(`  guild ${guildId}: failed to deploy`, error);
    }
}
