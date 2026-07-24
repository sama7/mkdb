import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';

import type { MkdbCommand, MkdbSubCommand } from '../types.js';
import { ALL_BRANDS, type Brand } from './_brand.js';
import searchCmd from './search.js';
import rankCmd from './rank.js';
import randomCmd from './random.js';
import ratingsCmd from './ratings.js';
import directorCmd from './director.js';
import actorCmd from './actor.js';
import topCmd, { DEFAULT_COUNT, MAX_COUNT, MIN_COUNT } from './top.js';
import { buildChoices, getFilterOptions, searchDirectors, type ListField } from './_filters.js';

const handlers: Record<string, MkdbSubCommand> = {
    search: searchCmd,
    rank: rankCmd,
    random: randomCmd,
    ratings: ratingsCmd,
    director: directorCmd,
    actor: actorCmd,
    top: topCmd,
};

/**
 * The command tree is identical for both networks — only the name shown to
 * users (`/mkdb` vs `/lkdb`) and the label inside the descriptions differ,
 * so it's built once per brand rather than duplicated.
 */
function buildData(brand: Brand) {
    return new SlashCommandBuilder()
        .setName(brand.command)
        .setDescription(`${brand.community} Kino Database utilities`)
        // search query:<text>
        .addSubcommand((sc) =>
            sc.setName('search')
                .setDescription(`Search ${brand.label} for a film`)
                .addStringOption((o) =>
                    o.setName('query').setDescription('Film title').setRequired(true),
                ),
        )
        // rank number:<1-1000>
        .addSubcommand((sc) =>
            sc.setName('rank')
                .setDescription(`Film at the given ${brand.label} rank`)
                .addIntegerOption((o) =>
                    o.setName('number').setDescription('1-1000').setMinValue(1).setMaxValue(1000).setRequired(true),
                ),
        )
        // random [scope]
        .addSubcommand((sc) =>
            sc
                .setName('random')
                .setDescription(`Random film from ${brand.label}`)
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
        // ratings query:<text>
        .addSubcommand((sc) =>
            sc.setName('ratings')
                .setDescription('Show community ratings for a film')
                .addStringOption((o) =>
                    o.setName('query').setDescription('Film title').setRequired(true),
                ),
        )
        // director query:<text>
        .addSubcommand((sc) =>
            sc.setName('director')
                .setDescription(`Search ${brand.label} by director`)
                .addStringOption((o) =>
                    o.setName('query').setDescription("Director's name").setRequired(true),
                ),
        )
        // actor query:<text>
        .addSubcommand((sc) =>
            sc.setName('actor')
                .setDescription(`Search ${brand.label} by actor`)
                .addStringOption((o) =>
                    o.setName('query').setDescription("Actor's name").setRequired(true),
                ),
        )
        // top [count] [filters…]
        // Every list filter takes a comma-separated string where a leading `-`
        // excludes, e.g. `countries: japan, -usa`. All options are autocompleted.
        .addSubcommand((sc) =>
            sc.setName('top')
                .setDescription(`Top ranked films (default ${DEFAULT_COUNT}), with optional filters`)
                .addIntegerOption((o) =>
                    o.setName('count')
                        .setDescription(`How many films (${MIN_COUNT}-${MAX_COUNT}, default ${DEFAULT_COUNT})`)
                        .setMinValue(MIN_COUNT).setMaxValue(MAX_COUNT).setRequired(false),
                )
                .addStringOption((o) =>
                    o.setName('genres')
                        .setDescription('e.g. drama, -comedy  (comma-separated; "-" excludes)')
                        .setAutocomplete(true).setRequired(false),
                )
                .addStringOption((o) =>
                    o.setName('directors')
                        .setDescription('e.g. kurosawa, -spielberg  (comma-separated; "-" excludes)')
                        .setAutocomplete(true).setRequired(false),
                )
                .addStringOption((o) =>
                    o.setName('countries')
                        .setDescription('e.g. japan, -usa  (comma-separated; "-" excludes)')
                        .setAutocomplete(true).setRequired(false),
                )
                .addStringOption((o) =>
                    o.setName('languages')
                        .setDescription('e.g. french, -english  (comma-separated; "-" excludes)')
                        .setAutocomplete(true).setRequired(false),
                )
                .addIntegerOption((o) => o.setName('min_year').setDescription('Earliest release year').setRequired(false))
                .addIntegerOption((o) => o.setName('max_year').setDescription('Latest release year').setRequired(false))
                .addIntegerOption((o) => o.setName('min_runtime').setDescription('Minimum runtime in minutes').setMinValue(0).setRequired(false))
                .addIntegerOption((o) => o.setName('max_runtime').setDescription('Maximum runtime in minutes').setMinValue(0).setRequired(false))
                .addIntegerOption((o) => o.setName('min_ratings').setDescription(`Minimum rating count (defaults to ${brand.defaultMinRatings})`).setMinValue(0).setRequired(false))
                .addIntegerOption((o) => o.setName('max_ratings').setDescription('Maximum rating count').setMinValue(0).setRequired(false)),
        );
}

function buildCommand(brand: Brand): MkdbCommand {
    return {
        data: buildData(brand),
        brand,

        /**
         * Autocomplete for the `top` filter options. Only the segment the user
         * is currently typing gets completed; the choice carries the whole
         * rebuilt string so picking one appends to the list rather than
         * replacing it (Discord otherwise overwrites the entire option value).
         */
        async autocomplete(interaction: AutocompleteInteraction) {
            const focused = interaction.options.getFocused(true);
            const current = focused.value ?? '';

            if (focused.name === 'directors') {
                // ~29k directors — always query the API for the typed segment.
                // The results come back ranked by film count, so keep that order.
                const lastComma = current.lastIndexOf(',');
                const segment = (lastComma === -1 ? current : current.slice(lastComma + 1)).trim();
                const term = segment.replace(/^[-!]/, '').trim();
                const candidates = await searchDirectors(brand.apiBase, term, 25);
                await interaction.respond(buildChoices(current, candidates, { preserveOrder: true }));
                return;
            }

            const options = await getFilterOptions(brand.apiBase);
            const candidates = options[focused.name as ListField] ?? [];
            await interaction.respond(buildChoices(current, candidates));
        },

        async execute(interaction: ChatInputCommandInteraction) {
            const sub = interaction.options.getSubcommand();
            const handler = handlers[sub];

            if (!handler) {
                return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
            }

            try {
                await handler.execute(interaction, brand);
            } catch (err) {
                console.error(err);
                const msg = { content: 'There was an error while executing that subcommand.', ephemeral: true };
                if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
                else await interaction.reply(msg);
            }
        },
    };
}

// One registered command per network. deploy-commands.ts decides which guild
// gets which; index.ts keys them by name so an interaction routes to its own.
const commands: MkdbCommand[] = ALL_BRANDS.map(buildCommand);

export default commands;
