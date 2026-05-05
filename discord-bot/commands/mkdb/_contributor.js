require('dotenv').config();
const {
  EmbedBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  escapeMarkdown,
} = require('discord.js');

const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';
const PAGE_SIZE = 8;

function formatStar(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}★`;
}

function rankSuffix(rank) {
  if (!rank) return '';
  return ` · #${rank}`;
}

async function runContributor(interaction, type, label) {
  await interaction.deferReply();
  const query = interaction.options.getString('query');

  let res;
  try {
    res = await fetch(
      `${MKDB_API_BASE}/films/by-contributor?query=${encodeURIComponent(query)}&type=${type}`,
    );
  } catch (err) {
    console.error(`MKDb ${type} fetch failed:`, err);
    return interaction.editReply('❌ Server error while searching.');
  }

  let payload;
  try { payload = await res.json(); } catch (_) { payload = null; }

  if (!res.ok) {
    if (payload?.code === 'NO_CONTRIBUTOR_FOUND') {
      return interaction.editReply(`🔍 No ${label.toLowerCase()} found for \`${query}\`. Please check your spelling.`);
    }
    console.log(`MKDb ${type} error:`, payload);
    return interaction.editReply('❌ Server error while searching.');
  }

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

  // Fetch the composite from our server, attach it as a file so Discord
  // doesn't need to reach out — works fully against localhost.
  async function buildPayload(page) {
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

    const slugList = slice.map((f) => f.slug).filter(Boolean).join(',');
    let attachment = null;
    let grid = null;
    try {
      const r = await fetch(`${MKDB_API_BASE}/posters-grid?slugs=${encodeURIComponent(slugList)}`);
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
  const row = new ActionRowBuilder().addComponents(
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

  collector.on('collect', async (btn) => {
    switch (btn.customId) {
      case 'first': page = 0; break;
      case 'prev':  page = Math.max(0, page - 1); break;
      case 'next':  page = Math.min(max, page + 1); break;
      case 'last':  page = max; break;
    }
    row.components.forEach((b) => {
      if (b.data.custom_id === 'first' || b.data.custom_id === 'prev') b.setDisabled(page === 0);
      else if (b.data.custom_id === 'next' || b.data.custom_id === 'last') b.setDisabled(page === max);
    });
    const payload = await buildPayload(page);
    await btn.update({ ...payload, components: [row] });
  });

  collector.on('end', () => {
    message.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { runContributor };
