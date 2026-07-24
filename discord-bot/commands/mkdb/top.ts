import 'dotenv/config';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    EmbedBuilder,
    escapeMarkdown,
    type BaseMessageOptions,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
} from 'discord.js';

import type { MkdbSubCommand } from '../types.js';
import {
    describeFilters,
    getFilterOptions,
    normalizeFilters,
    resolveAgainstList,
    resolveDirectors,
    type TopFilters,
} from './_filters.js';

const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';

const PAGE_SIZE = 8;          // matches the poster grid's 4×2 layout
export const MAX_COUNT = 120;  // 15 pages at 8 per page
export const MIN_COUNT = 1;
export const DEFAULT_COUNT = 40;

interface TopFilm {
    slug?: string | null;
    title: string;
    year?: number | null;
    ranking?: number | string | null;
    average_rating?: number | string | null;
    rating_count?: number | string;
    total_count?: string;
}

function formatStar(value: number | string | null | undefined): string {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}★` : '—';
}

/** Read an integer option, returning undefined when it wasn't supplied. */
function intOption(interaction: ChatInputCommandInteraction, name: string): number | undefined {
    const v = interaction.options.getInteger(name);
    return v === null ? undefined : v;
}

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const count = Math.min(
            MAX_COUNT,
            Math.max(MIN_COUNT, interaction.options.getInteger('count') ?? DEFAULT_COUNT),
        );

        // Resolve the free-text filter options against the real values so
        // "japan, -usa" becomes { Japan: include, USA: exclude }.
        const options = await getFilterOptions();
        const genres = resolveAgainstList(interaction.options.getString('genres'), options.genres);
        const countries = resolveAgainstList(interaction.options.getString('countries'), options.countries);
        const languages = resolveAgainstList(interaction.options.getString('languages'), options.languages);
        const directors = await resolveDirectors(interaction.options.getString('directors'));

        const unknown = [...genres.unknown, ...countries.unknown, ...languages.unknown, ...directors.unknown];

        const filters: TopFilters = normalizeFilters({
            genres: genres.filters,
            countries: countries.filters,
            languages: languages.filters,
            directors: directors.filters,
            minYear: intOption(interaction, 'min_year'),
            maxYear: intOption(interaction, 'max_year'),
            minRuntime: intOption(interaction, 'min_runtime'),
            maxRuntime: intOption(interaction, 'max_runtime'),
            minRatings: intOption(interaction, 'min_ratings'),
            maxRatings: intOption(interaction, 'max_ratings'),
        });

        let films: TopFilm[];
        try {
            const url = `${MKDB_API_BASE}/top?limit=${count}&filters=${encodeURIComponent(JSON.stringify(filters))}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`status ${res.status}`);
            films = (await res.json()) as TopFilm[];
        } catch (err) {
            console.error('MKDb top fetch failed:', err);
            return interaction.editReply('❌ Server error while fetching the rankings.');
        }

        const filterLines = describeFilters(filters);
        const unknownNote = unknown.length
            ? `\n⚠️ Ignored unrecognized value${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `\`${u}\``).join(', ')}`
            : '';

        if (!films.length) {
            return interaction.editReply(
                `🔍 No films matched those filters.${filterLines.length ? `\n**Filters:** ${filterLines.join(' · ')}` : ''}${unknownNote}`,
            );
        }

        const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE));

        async function buildPayload(page: number): Promise<BaseMessageOptions> {
            const start = page * PAGE_SIZE;
            const slice = films.slice(start, start + PAGE_SIZE);

            const lines = slice.map((f, i) => {
                const rank = f.ranking ?? start + i + 1;
                const titleLink = `[*${escapeMarkdown(f.title)}*](${MKDB_BASE_URL}/film/${f.slug})`;
                const yr = f.year ? ` (${f.year})` : '';
                return `**${rank}.** ${titleLink}${yr} — ${formatStar(f.average_rating)} / ${f.rating_count}`;
            });

            const anchor = new EmbedBuilder()
                .setTitle(`🏆 Top ${films.length} Ranked Film${films.length === 1 ? '' : 's'}`)
                .setURL(MKDB_BASE_URL)
                .setDescription(lines.join('\n'))
                .setFooter({ text: `Page ${page + 1}/${totalPages} · sorted by MKDb rank` });

            if (filterLines.length) {
                anchor.addFields({ name: 'Filters', value: filterLines.join('\n').slice(0, 1024) });
            }

            // Label each tile with its MKDb rank so the grid lines up with the
            // numbered list above it.
            const withSlugs = slice
                .map((f, i) => ({ slug: f.slug, rank: f.ranking ?? start + i + 1 }))
                .filter((f) => f.slug);
            const slugList = withSlugs.map((f) => f.slug).join(',');
            const labelList = withSlugs.map((f) => String(f.rank)).join(',');
            let attachment: AttachmentBuilder | null = null;
            let grid: EmbedBuilder | null = null;
            try {
                const r = await fetch(
                    `${MKDB_API_BASE}/posters-grid?slugs=${encodeURIComponent(slugList)}&labels=${encodeURIComponent(labelList)}`,
                );
                if (r.ok) {
                    const buf = Buffer.from(await r.arrayBuffer());
                    const name = `top-${page}.jpg`;
                    attachment = new AttachmentBuilder(buf, { name });
                    grid = new EmbedBuilder().setImage(`attachment://${name}`);
                }
            } catch (err) {
                console.warn('posters-grid fetch failed:', (err as Error).message);
            }

            return {
                content: unknownNote ? unknownNote.trim() : undefined,
                embeds: grid ? [anchor, grid] : [anchor],
                files: attachment ? [attachment] : [],
            };
        }

        let page = 0;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('first').setLabel('⏮').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('last').setLabel('⏭').setStyle(ButtonStyle.Primary),
        );

        const max = totalPages - 1;
        const setDisabled = () => {
            row.components[0].setDisabled(page === 0);
            row.components[1].setDisabled(page === 0);
            row.components[2].setDisabled(page === max);
            row.components[3].setDisabled(page === max);
        };
        setDisabled();

        const initial = await buildPayload(page);
        const message = await interaction.editReply({
            ...initial,
            components: totalPages > 1 ? [row] : [],
        });

        if (totalPages <= 1) return;

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
        });

        collector.on('collect', async (btn: ButtonInteraction) => {
            switch (btn.customId) {
                case 'first': page = 0; break;
                case 'prev': page = Math.max(0, page - 1); break;
                case 'next': page = Math.min(max, page + 1); break;
                case 'last': page = max; break;
            }
            setDisabled();
            const next = await buildPayload(page);
            await btn.update({ ...next, components: [row] });
        });

        collector.on('end', () => {
            message.edit({ components: [] }).catch(() => { });
        });
    },
};

export default subcommand;
