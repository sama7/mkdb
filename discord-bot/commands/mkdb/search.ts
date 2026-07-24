import 'dotenv/config';
import {
    EmbedBuilder,
    escapeMarkdown,
    type ChatInputCommandInteraction,
} from 'discord.js';

import type { MkdbSubCommand } from '../types.js';
import type { Brand } from './_brand.js';
import { formatRuntime, truncateSynopsis } from './_format.js';
import { fetchThumbAttachment } from './_thumbnail.js';


interface FilmPayload {
    title: string;
    year?: number | null;
    directors?: string[];
    genres?: string[];
    countries?: string[];
    languages?: string[];
    runtime?: number | null;
    synopsis?: string | null;
    current_rank?: number | null;
    average_rating?: number | string | null;
    rating_count?: number | string;
}

interface SearchPayload {
    slug?: string;
    film?: FilmPayload;
    code?: string;
    message?: string;
    error?: string;
}

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction, brand: Brand) {
        await interaction.deferReply();
        const query = interaction.options.getString('query', true);

        const res = await fetch(
            `${brand.apiBase}/films/search?query=${encodeURIComponent(query)}`,
        );

        // Try to parse JSON even when the status is not 200
        let payload: SearchPayload | null;
        try {
            payload = (await res.json()) as SearchPayload;
        } catch {
            payload = null;
        }

        if (!res.ok) {
            if (payload?.code === 'NO_LETTERBOXD_RESULT') {
                return interaction.editReply(`🔍  No film found for \`${query}\`. Please check your spelling.`);
            }
            if (payload?.code === 'NOT_ON_MKDB') {
                return interaction.editReply(
                    `We found a film, but it's not on ${brand.label}. That means none of us have rated it yet. ` +
                    `Please try sending the command: \`!f ${query}\``,
                );
            }
            console.log('`${brand.label} search error:`', payload);
            return interaction.editReply('❌  Server error while searching.');
        }

        const film = payload?.film;
        const slug = payload?.slug;
        if (!film || !slug) {
            return interaction.editReply('❌  Unexpected response from server.');
        }

        // Build description: directors → genres → countries → languages → runtime → synopsis
        const descParts: string[] = [];
        if (Array.isArray(film.directors) && film.directors.length) descParts.push(film.directors.join(', '));
        if (Array.isArray(film.genres) && film.genres.length) descParts.push(film.genres.join(', '));
        if (Array.isArray(film.countries) && film.countries.length) descParts.push(film.countries.join(', '));
        if (Array.isArray(film.languages) && film.languages.length) descParts.push(film.languages.join(', '));
        const rt = formatRuntime(film.runtime);
        if (rt) descParts.push(rt);

        if (film.synopsis) {
            descParts.push('');
            descParts.push(truncateSynopsis(film.synopsis, 500));
        }

        // Fetch the thumbnail from the MKDb server and upload it inline so
        // Discord doesn't have to reach a public URL — works against a local
        // dev server too.
        const thumb = await fetchThumbAttachment(slug);

        const embed = new EmbedBuilder()
            .setTitle(`*${escapeMarkdown(film.title)}* (${film.year ?? '—'})`)
            .setURL(`${brand.siteBase}/film/${slug}`)
            .setDescription(descParts.join('\n') || '—')
            .addFields(
                { name: `${brand.label} Rank`, value: film.current_rank ? `#${film.current_rank}` : 'N/A', inline: true },
                { name: 'Average ★', value: Number(film.average_rating).toFixed(2), inline: true },
                { name: 'Rating Count', value: `${film.rating_count}`, inline: true },
            )
            .setFooter({ text: `${brand.community} Kino Database` });

        if (thumb) embed.setThumbnail(thumb.thumbnailUrl);

        return interaction.editReply({
            embeds: [embed],
            ...(thumb ? { files: [thumb.attachment] } : {}),
        });
    },
};

export default subcommand;
