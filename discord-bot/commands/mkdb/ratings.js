require('dotenv').config();
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';
const PAGE_SIZE = 10;     // ratings shown per page

// Convert a numeric rating to star/half‑star symbols
function getStarSymbols(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 === 0.5 ? '½' : '';
  return '★'.repeat(full) + half;
}

module.exports = {
  meta: {
    name: 'ratings',
    description: 'Show MKDb community ratings for a film',
    options: [
      {
        name: 'query',
        description: 'Film title to look up',
        type: 3,
        required: true,
      },
    ],
  },

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    /* ─────────────────────────────────────────────────────────
       Call ONE endpoint:
         /films/ratings?query=<encoded title>
       Returns { slug, film, ratings }
    ───────────────────────────────────────────────────────── */
    const res = await fetch(
      `${MKDB_API_BASE}/films/ratings?query=${encodeURIComponent(query)}`,
    );

    if (!res.ok) {
      return interaction.editReply('❌  Could not fetch that film / ratings.');
    }

    const { slug, film, ratings } = await res.json();

    if (!film) return interaction.editReply('Film not found.');
    if (!ratings?.length) {
      return interaction.editReply('Nobody in the community has rated this yet.');
    }

    /* ----- pre‑compute linear list of lines grouped by star value ----- */
    const starOrder = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5];
    const groupedLines = [];
    for (const star of starOrder) {
      const users = ratings.filter(r => Math.round(r.rating * 10) / 10 === star);
      if (!users.length) continue;
      const header = `**${getStarSymbols(star)}**:`;    // add colon for clarity
      users.forEach((u, idx) => {
        if (idx === 0) groupedLines.push(header);   // repeat header for first user
        const name      = u.display_name ?? u.username;
        const profile   = `https://letterboxd.com/${u.username}`;
        const activity  = `https://letterboxd.com/${u.username}/film/${slug}/activity/`;
        groupedLines.push(`• [${name}](${profile}) - [activity](${activity})`);
      });
    }

    const TOTAL_PAGES = Math.max(1, Math.ceil(groupedLines.length / PAGE_SIZE));

    const buildEmbed = (page) => {
      const start = page * PAGE_SIZE;
      let slice = groupedLines.slice(start, start + PAGE_SIZE);

      /* ensure every page starts with a header */
      if (slice.length && !slice[0].startsWith('**')) {
        // scan backwards for the previous header
        for (let i = start - 1; i >= 0; i--) {
          if (groupedLines[i].startsWith('**')) {
            slice = [groupedLines[i], ...slice];
            break;
          }
        }
        slice = slice.slice(0, PAGE_SIZE); // keep page size constant
      }

      // If the slice ends with a header but no user lines, drop that header
      if (slice.length && slice[slice.length - 1].startsWith('**')) {
        slice.pop();
      }

      return new EmbedBuilder()
        .setTitle(`${film.title} (${film.year ?? '—'}) — Community ratings`)
        .setURL(`${MKDB_BASE_URL}/film/${slug}`)
        .setThumbnail(`${MKDB_BASE_URL}/images/posters/${slug}.jpg`)
        .setDescription(slice.join('\n'))
        .addFields(
          { name: 'Average ★', value: Number(film.average_rating).toFixed(2), inline: true },
          { name: 'Rating count', value: `${film.rating_count}`, inline: true },
          { name: 'MKDb rank', value: film.current_rank ? `#${film.current_rank}` : '—', inline: true },
        )
        .setFooter({ text: `Page ${page + 1}/${TOTAL_PAGES}` });
    };

    /* ── initial page ─────────────────────────────────────── */
    let page = 0;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('first')
        .setLabel('⏮')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('◀')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('▶')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('last')
        .setLabel('⏭')
        .setStyle(ButtonStyle.Primary),
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

    /* ── button collector ───────────────────── */
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      //idle: 900_000,          // 15 min idle timeout
    });

    collector.on('collect', async (btn) => {
      const max = TOTAL_PAGES - 1;
      switch (btn.customId) {
        case 'first':
          page = 0;
          break;
        case 'prev':
          page = Math.max(0, page - 1);
          break;
        case 'next':
          page = Math.min(max, page + 1);
          break;
        case 'last':
          page = max;
          break;
      }

      /* Enable / disable buttons at limits */
      row.components.forEach(b => {
        if (b.data.custom_id === 'first' || b.data.custom_id === 'prev') {
          b.setDisabled(page === 0);
        } else if (b.data.custom_id === 'next' || b.data.custom_id === 'last') {
          b.setDisabled(page === max);
        }
      });

      await btn.update({ embeds: [buildEmbed(page)], components: [row] });
    });

    collector.on('end', () => {
      message.edit({ components: [] }).catch(() => { });
    });
  },
};