import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { REST, Routes } from 'discord.js';

import type { MkdbCommand } from './commands/types.js';

const clientId = process.env.clientId;
const guildId = process.env.guildId;
const token = process.env.DISCORD_TOKEN;

if (!token) throw new Error('Missing DISCORD_TOKEN in your .env');
if (!clientId) throw new Error('Missing clientId in your .env');
if (!guildId) throw new Error('Missing guildId in your .env');

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

try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // The PUT method fully replaces all guild commands with the current set.
    const data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
    );

    const refreshedCount = Array.isArray(data) ? data.length : 0;
    console.log(`Successfully reloaded ${refreshedCount} application (/) commands.`);
} catch (error) {
    console.error(error);
}
