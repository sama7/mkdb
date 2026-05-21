import 'dotenv/config';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    EmbedBuilder,
    escapeMarkdown,
    type ButtonInteraction,
    type ChatInputCommandInteraction,
} from 'discord.js';

import type { MkdbSubCommand } from '../types.js';

const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';
const PAGE_SIZE = 10;

interface FilmPayload {
    title: string;
    year?: number | null;
    average_rating?: number | string | null;
    rating_count?: number | string;
    current_rank?: number | null;
}

interface RatingRow {
    rating: number;
    username: string;
    display_name?: string | null;
}

interface RatingsPayload {
    slug?: string;
    film?: FilmPayload;
    ratings?: RatingRow[];
    code?: string;
    message?: string;
    error?: string;
}

// Convert a numeric rating to star/half-star symbols
function getStarSymbols(rating: number): string {
    const full = Math.floor(rating);
    const half = rating % 1 === 0.5 ? '½' : '';
    return '★'.repeat(full) + half;
}

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        const query = interaction.options.getString('query', true);

        // Single-call endpoint: /films/ratings?query=<title> → { slug, film, ratings }
        const res = await fetch(
            `${MKDB_API_BASE}/films/ratings?query=${encodeURIComponent(query)}`,
        );

        let payload: RatingsPayload | null;
        try {
            payload = (await res.json()) as RatingsPayload;
        } catch {
            payload = null;
        }

        if (!res.ok) {
            if (payload?.code === 'NO_LETTERBOXD_RESULT') {
                return interaction.editReply(`🔍 No film found for \`${query}\`. Please check your spelling.`);
            }
            if (payload?.code === 'NOT_ON_MKDB') {
                return interaction.editReply(
                    `We found a film, but it's not on MKDb. That means none of us have ` +
                    `rated it yet. Please try sending the command: \`!f ${query}\``,
                );
            }
            return interaction.editReply('❌ Server error while searching.');
        }

        const slug = payload?.slug;
        const film = payload?.film;
        const ratings = payload?.ratings ?? [];

        if (!film || !slug) {
            return interaction.editReply('❌ Unexpected response from server.');
        }

        // Pre-compute a flat list of lines grouped by star value: each
        // group starts with a bold star header followed by user lines.
        const starOrder = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5];
        const groupedLines: string[] = [];
        for (const star of starOrder) {
            const users = ratings.filter((r) => Math.round(r.rating * 10) / 10 === star);
            if (!users.length) continue;
            const header = `**${getStarSymbols(star)}**:`;
            users.forEach((u, idx) => {
                if (idx === 0) groupedLines.push(header);
                const name = u.display_name ?? u.username;
                const profile = `https://letterboxd.com/${u.username}`;
                const activity = `https://letterboxd.com/${u.username}/film/${slug}/activity/`;
                groupedLines.push(`• [${name}](${profile}) - [activity](${activity})`);
            });
        }

        const TOTAL_PAGES = Math.max(1, Math.ceil(groupedLines.length / PAGE_SIZE));

        const buildEmbed = (page: number): EmbedBuilder => {
            const start = page * PAGE_SIZE;
            let slice = groupedLines.slice(start, start + PAGE_SIZE);

            // Ensure every page starts with the relevant star header. If
            // the slice begins mid-group, prepend the header from earlier.
            if (slice.length && !slice[0].startsWith('**')) {
                for (let i = start - 1; i >= 0; i--) {
                    if (groupedLines[i].startsWith('**')) {
                        slice = [groupedLines[i], ...slice];
                        break;
                    }
                }
                slice = slice.slice(0, PAGE_SIZE);
            }

            // Drop a trailing header that has no user lines under it.
            if (slice.length && slice[slice.length - 1].startsWith('**')) {
                slice.pop();
            }

            return new EmbedBuilder()
                .setTitle(`*${escapeMarkdown(film.title)}* (${film.year ?? '—'}) — Community ratings`)
                .setURL(`${MKDB_BASE_URL}/film/${slug}`)
                .setThumbnail(`https://mkdb.co/images/discord-thumb/${slug}.jpg`)
                .setDescription(slice.join('\n'))
                .addFields(
                    { name: 'Average ★', value: Number(film.average_rating).toFixed(2), inline: true },
                    { name: 'Rating count', value: `${film.rating_count}`, inline: true },
                    { name: 'MKDb rank', value: film.current_rank ? `#${film.current_rank}` : '—', inline: true },
                )
                .setFooter({ text: `Page ${page + 1}/${TOTAL_PAGES}` });
        };

        let page = 0;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId('first').setLabel('⏮').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('last').setLabel('⏭').setStyle(ButtonStyle.Primary),
        );

        const max = TOTAL_PAGES - 1;
        row.components[0].setDisabled(page === 0);   // ⏮ first
        row.components[1].setDisabled(page === 0);   // ◀  prev
        row.components[2].setDisabled(page === max); // ▶  next
        row.components[3].setDisabled(page === max); // ⏭ last

        const message = await interaction.editReply({
            embeds: [buildEmbed(page)],
            components: [row],
        });

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

            row.components[0].setDisabled(page === 0);   // ⏮ first
            row.components[1].setDisabled(page === 0);   // ◀  prev
            row.components[2].setDisabled(page === max); // ▶  next
            row.components[3].setDisabled(page === max); // ⏭ last

            await btn.update({ embeds: [buildEmbed(page)], components: [row] });
        });

        collector.on('end', () => {
            message.edit({ components: [] }).catch(() => { });
        });
    },
};

export default subcommand;
