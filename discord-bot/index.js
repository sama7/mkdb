// /discord-bot/index.js
require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');
const fs   = require('node:fs');
const path = require('node:path');

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Missing DISCORD_TOKEN in your .env');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/**
 * ┌ commands
 * │  └ mkdb
 * │      ├─ search.js
 * │      ├─ rank.js
 * │      ├─ random.js
 * │      └─ ratings.js
 * └ …
 *
 * The key we’ll store in client.commands will be "mkdb-search",
 * "mkdb-rank", etc.  That makes the lookup in the interaction handler simple.
 */
client.commands = new Collection();

const commandsRoot = path.join(__dirname, 'commands');

for (const groupFolder of fs.readdirSync(commandsRoot)) {
  const groupIndex = path.join(commandsRoot, groupFolder, 'index.js');

  // Skip if the folder doesn't contain an index.js
  if (!fs.existsSync(groupIndex)) continue;

  const command = require(groupIndex);

  if (command?.data && command?.execute) {
    // key is the top‑level command name, e.g. "mkdb"
    client.commands.set(command.data.name, command);
  } else {
    console.warn(
      `[WARNING] The command at ${groupIndex} is missing a required "data" or "execute" property.`,
    );
  }
}

client.once(Events.ClientReady, readyClient => {
  console.log(`✅  Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /** top‑level command name:  "mkdb" */
  const groupName = interaction.commandName;

  /* 1️⃣ fetch the parent handler */
  const command   = interaction.client.commands.get(groupName);

  if (!command) {
    console.error(`[ERROR] No command handler found for ${groupName}`);
    return;
  }

  try {
    /* 2️⃣ the parent’s execute() routes to its sub‑command (search / rank / random / ratings) */
    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const reply = { content: 'There was an error while executing this command!', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
});

client.login(token);