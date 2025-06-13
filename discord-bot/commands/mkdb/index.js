const { SlashCommandBuilder } = require('discord.js');
const path = require('node:path');
const subcmds = ['search', 'rank', 'random', 'ratings'];

// Load each sub‑command file once and cache it
const handlers = Object.fromEntries(
  subcmds.map(name => {
    const file = path.join(__dirname, `${name}.js`);
    return [name, require(file)];
  }),
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mkdb')
    .setDescription('Metropolis Kino Database utilities')
    // /mkdb search query:<text>
    .addSubcommand(sc =>
      sc.setName('search')
        .setDescription('Search MKDb for a film')
        .addStringOption(o =>
          o.setName('query').setDescription('Film title').setRequired(true),
        ),
    )
    // /mkdb rank rank:<1‑1000>
    .addSubcommand(sc =>
      sc.setName('rank')
        .setDescription('Film at the given MKDb rank')
        .addIntegerOption(o =>
          o.setName('number').setDescription('1‑1000').setMinValue(1).setMaxValue(1000).setRequired(true),
        ),
    )
    // /mkdb random [scope]
    .addSubcommand(sc =>
      sc
        .setName('random')
        .setDescription('Random film from MKDb')
        .addStringOption(o =>
          o
            .setName('scope')
            .setDescription('Where to pick the film from')
            .addChoices(
              { name: 'top1000', value: 'top1000' },
              { name: 'ultramank', value: 'ultramank' },
              { name: 'nearmank', value: 'nearmank' },
            )
            .setRequired(false),
        ),
    )
    // /mkdb ratings query:<text>
    .addSubcommand(sc =>
      sc.setName('ratings')
        .setDescription('Show community ratings for a film')
        .addStringOption(o =>
          o.setName('query').setDescription('Film title').setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const handler = handlers[sub];

    if (!handler) {
      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    }
    try {
      await handler.execute(interaction);
    } catch (err) {
      console.error(err);
      const msg = { content: 'There was an error while executing that subcommand.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  },
};