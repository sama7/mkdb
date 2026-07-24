import 'dotenv/config';
import {
    EmbedBuilder,
    escapeMarkdown,
    type ChatInputCommandInteraction,
} from 'discord.js';

import type { MkdbSubCommand } from '../types.js';
import type { Brand } from './_brand.js';
import { formatRuntime, truncateSynopsis } from './_format.js';


interface FilmPayload {
    title: string;
    year?: number | null;
    slug: string;
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

interface RankPayload {
    film?: FilmPayload;
    error?: string;
}

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction, brand: Brand) {
        await interaction.deferReply();

        const scope = (interaction.options.getString('scope') || 'top1000').toLowerCase();

        // Decide which bucket we're drawing from
        let topFilmScope: number;   // size of the bucket we can pick a rank from
        let apiPathBase: string;    // which API endpoint to hit

        switch (scope) {
            case 'ultramank':           // top 250
                topFilmScope = 250;
                apiPathBase = '/films/rank/';
                break;

            case 'nearmank':            // top 100 high-average films with 7-9 ratings
                topFilmScope = 100;
                apiPathBase = '/films/nearmank/';
                break;

            default:                    // 'top1000'
                topFilmScope = 1000;
                apiPathBase = '/films/rank/';
        }

        const rank = Math.floor(Math.random() * topFilmScope) + 1;

        const res = await fetch(`${brand.apiBase}${apiPathBase}${rank}`);
        if (!res.ok) return interaction.editReply('❌  Could not fetch that rank.');

        const { film } = (await res.json()) as RankPayload;
        if (!film) return interaction.editReply('Rank not found in the selected list.');

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

        const embed = new EmbedBuilder()
            .setTitle(`*${escapeMarkdown(film.title)}* (${film.year ?? '—'})`)
            .setURL(`${brand.siteBase}/film/${film.slug}`)
            .setDescription(descParts.join('\n') || '—')
            .setThumbnail(`https://mkdb.co/images/posters/${film.slug}.jpg`)
            .addFields(
                { name: `${brand.label} Rank`, value: film.current_rank ? `#${film.current_rank}` : 'N/A', inline: true },
                { name: 'Average ★', value: Number(film.average_rating).toFixed(2), inline: true },
                { name: 'Rating Count', value: `${film.rating_count}`, inline: true },
            )
            .setFooter({ text: `${brand.community} Kino Database` });

        return interaction.editReply({ embeds: [embed] });
    },
};

export default subcommand;
