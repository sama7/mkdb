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

const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';
const PAGE_SIZE = 8;

export type ContributorType = 'Director' | 'Actor';

interface ContributorPayload {
    name: string;
    photo_url?: string | null;
    profile_url?: string | null;
}

interface ContributorFilm {
    slug?: string | null;
    title: string;
    year?: number | null;
    average_rating?: number | string | null;
    rating_count?: number | string;
    current_rank?: number | null;
}

interface ContributorResponse {
    contributor: ContributorPayload;
    films: ContributorFilm[];
    total_letterboxd: number;
    code?: string;
    message?: string;
    error?: string;
}

function formatStar(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(2)}★`;
}

function rankSuffix(rank: number | null | undefined): string {
    if (!rank) return '';
    return ` · #${rank}`;
}

export async function runContributor(
    interaction: ChatInputCommandInteraction,
    type: ContributorType,
    label: ContributorType,
): Promise<unknown> {
    await interaction.deferReply();
    const query = interaction.options.getString('query', true);

    let res: Response;
    try {
        res = await fetch(
            `${MKDB_API_BASE}/films/by-contributor?query=${encodeURIComponent(query)}&type=${type}`,
        );
    } catch (err) {
        console.error(`MKDb ${type} fetch failed:`, err);
        return interaction.editReply('❌ Server error while searching.');
    }

    let payload: ContributorResponse | null;
    try {
        payload = (await res.json()) as ContributorResponse;
    } catch {
        payload = null;
    }

    if (!res.ok) {
        if (payload?.code === 'NO_CONTRIBUTOR_FOUND') {
            return interaction.editReply(`🔍 No ${label.toLowerCase()} found for \`${query}\`. Please check your spelling.`);
        }
        console.log(`MKDb ${type} error:`, payload);
        return interaction.editReply('❌ Server error while searching.');
    }

    if (!payload) return interaction.editReply('❌ Unexpected response from server.');

    const { contributor, films, total_letterboxd } = payload;

    if (!films?.length) {
        const embed = new EmbedBuilder()
            .setTitle(escapeMarkdown(contributor.name))
            .setURL(contributor.profile_url || null)
            .setDescription(
                `No films from this ${label.toLowerCase()} are on MKDb yet.\n` +
                `Letterboxd lists ${total_letterboxd} ${label.toLowerCase()} credit${total_letterboxd === 1 ? '' : 's'}.`,
            );
        if (contributor.photo_url) embed.setThumbnail(contributor.photo_url);
        return interaction.editReply({ embeds: [embed] });
    }

    const totalPages = Math.max(1, Math.ceil(films.length / PAGE_SIZE));

    // For each page, fetch a 4×2 poster composite from our own server and
    // attach it as a file. That avoids depending on a public image URL
    // (works even when the bot talks to localhost).
    async function buildPayload(page: number): Promise<BaseMessageOptions> {
        const start = page * PAGE_SIZE;
        const slice = films.slice(start, start + PAGE_SIZE);

        const lines = slice.map((f, i) => {
            const n = start + i + 1;
            const titleLink = `[*${escapeMarkdown(f.title)}*](${MKDB_BASE_URL}/film/${f.slug})`;
            const yr = f.year ? ` (${f.year})` : '';
            return `**${n}.** ${titleLink}${yr} — ${formatStar(f.average_rating)} / ${f.rating_count}${rankSuffix(f.current_rank)}`;
        });

        const anchor = new EmbedBuilder()
            .setTitle(`${label === 'Director' ? '🎬' : '🎭'} ${escapeMarkdown(contributor.name)}`)
            .setURL(contributor.profile_url || null)
            .setDescription(lines.join('\n'))
            .addFields(
                { name: `${label} credits on MKDb`, value: `${films.length}`, inline: true },
                { name: 'Total on Letterboxd', value: `${total_letterboxd}`, inline: true },
            )
            .setFooter({ text: `Page ${page + 1}/${totalPages} · sorted by MKDb rank` });

        if (contributor.photo_url) anchor.setThumbnail(contributor.photo_url);

        // Number each tile to match the list above it (1-based across pages).
        const withSlugs = slice
            .map((f, i) => ({ slug: f.slug, n: start + i + 1 }))
            .filter((f) => f.slug);
        const slugList = withSlugs.map((f) => f.slug).join(',');
        const labelList = withSlugs.map((f) => String(f.n)).join(',');
        let attachment: AttachmentBuilder | null = null;
        let grid: EmbedBuilder | null = null;
        try {
            const r = await fetch(
                `${MKDB_API_BASE}/posters-grid?slugs=${encodeURIComponent(slugList)}&labels=${encodeURIComponent(labelList)}`,
            );
            if (r.ok) {
                const buf = Buffer.from(await r.arrayBuffer());
                const name = `posters-${page}.jpg`;
                attachment = new AttachmentBuilder(buf, { name });
                grid = new EmbedBuilder().setImage(`attachment://${name}`);
            }
        } catch (err) {
            console.warn('posters-grid fetch failed:', err.message);
        }

        return {
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
    row.components[0].setDisabled(page === 0);
    row.components[1].setDisabled(page === 0);
    row.components[2].setDisabled(page === max);
    row.components[3].setDisabled(page === max);

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
        row.components[0].setDisabled(page === 0);   // ⏮ first
        row.components[1].setDisabled(page === 0);   // ◀  prev
        row.components[2].setDisabled(page === max); // ▶  next
        row.components[3].setDisabled(page === max); // ⏭ last
        const next = await buildPayload(page);
        await btn.update({ ...next, components: [row] });
    });

    collector.on('end', () => {
        message.edit({ components: [] }).catch(() => { });
    });
}
