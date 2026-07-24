import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';

import type { MkdbCommand } from './commands/types.js';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Missing DISCORD_TOKEN in your .env');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/**
 * ┌ commands
 * │  └ mkdb
 * │      ├─ index.ts        ← parent command(s) (registered in client.commands)
 * │      ├─ search.ts
 * │      ├─ rank.ts
 * │      ├─ random.ts
 * │      ├─ ratings.ts
 * │      ├─ director.ts
 * │      ├─ actor.ts
 * │      ├─ _brand.ts       ← per-network naming/URLs, not auto-loaded
 * │      └─ _contributor.ts ← shared helper, not auto-loaded
 * └ …
 *
 * The key in client.commands is the parent command name. A folder's index.js
 * exports an array because one implementation is registered once per network
 * ("mkdb" for Metropolis, "lkdb" for Lycan); the command name an interaction
 * arrives under is what selects the network. Each parent dispatches to its own
 * subcommands internally.
 */
client.commands = new Collection<string, MkdbCommand>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const commandsRoot = join(__dirname, 'commands');

for (const groupFolder of readdirSync(commandsRoot)) {
    const groupIndex = join(commandsRoot, groupFolder, 'index.js');
    if (!existsSync(groupIndex)) continue;

    // pathToFileURL is required for dynamic import on absolute paths
    // under ESM — Node rejects bare absolute paths for security.
    const mod = await import(pathToFileURL(groupIndex).href);
    // Typed as Partial because the dynamic import resolves to `any`;
    // the runtime presence check below is what actually validates the shape.
    const exported = mod.default as Partial<MkdbCommand>[] | Partial<MkdbCommand> | undefined;

    for (const command of Array.isArray(exported) ? exported : [exported]) {
        if (command?.data && command?.execute) {
            client.commands.set(command.data.name, command as MkdbCommand);
        } else {
            console.warn(
                `[WARNING] The command at ${groupIndex} is missing a required "data" or "execute" property.`,
            );
        }
    }
}

client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅  Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    // Autocomplete arrives as its own interaction type and must be answered
    // within 3s, so it's handled before (and separately from) command dispatch.
    if (interaction.isAutocomplete()) {
        const handler = interaction.client.commands.get(interaction.commandName);
        if (!handler?.autocomplete) return;
        try {
            await handler.autocomplete(interaction);
        } catch (err) {
            console.error('[autocomplete]', err);
            // Responding with an empty list beats leaving the client spinning.
            if (!interaction.responded) await interaction.respond([]).catch(() => { });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    const groupName = interaction.commandName;
    const command = interaction.client.commands.get(groupName);

    if (!command) {
        console.error(`[ERROR] No command handler found for ${groupName}`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(err);
        const reply = { content: 'There was an error while executing this command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
        else await interaction.reply(reply);
    }
});

client.login(token);
