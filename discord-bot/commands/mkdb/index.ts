import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import type { MkdbCommand, MkdbSubCommand } from '../types.js';
import searchCmd from './search.js';
import rankCmd from './rank.js';
import randomCmd from './random.js';
import ratingsCmd from './ratings.js';
import directorCmd from './director.js';
import actorCmd from './actor.js';

const handlers: Record<string, MkdbSubCommand> = {
    search: searchCmd,
    rank: rankCmd,
    random: randomCmd,
    ratings: ratingsCmd,
    director: directorCmd,
    actor: actorCmd,
};

const data = new SlashCommandBuilder()
    .setName('mkdb')
    .setDescription('Metropolis Kino Database utilities')
    // /mkdb search query:<text>
    .addSubcommand((sc) =>
        sc.setName('search')
            .setDescription('Search MKDb for a film')
            .addStringOption((o) =>
                o.setName('query').setDescription('Film title').setRequired(true),
            ),
    )
    // /mkdb rank number:<1-1000>
    .addSubcommand((sc) =>
        sc.setName('rank')
            .setDescription('Film at the given MKDb rank')
            .addIntegerOption((o) =>
                o.setName('number').setDescription('1-1000').setMinValue(1).setMaxValue(1000).setRequired(true),
            ),
    )
    // /mkdb random [scope]
    .addSubcommand((sc) =>
        sc
            .setName('random')
            .setDescription('Random film from MKDb')
            .addStringOption((o) =>
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
    .addSubcommand((sc) =>
        sc.setName('ratings')
            .setDescription('Show community ratings for a film')
            .addStringOption((o) =>
                o.setName('query').setDescription('Film title').setRequired(true),
            ),
    )
    // /mkdb director query:<text>
    .addSubcommand((sc) =>
        sc.setName('director')
            .setDescription('Search MKDb by director')
            .addStringOption((o) =>
                o.setName('query').setDescription("Director's name").setRequired(true),
            ),
    )
    // /mkdb actor query:<text>
    .addSubcommand((sc) =>
        sc.setName('actor')
            .setDescription('Search MKDb by actor')
            .addStringOption((o) =>
                o.setName('query').setDescription("Actor's name").setRequired(true),
            ),
    );

const command: MkdbCommand = {
    data,
    async execute(interaction: ChatInputCommandInteraction) {
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

export default command;
