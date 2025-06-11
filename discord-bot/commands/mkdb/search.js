require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const MKDB_API_BASE = process.env.MKDB_API_BASE_URL;
const MKDB_BASE_URL = process.env.MKDB_BASE_URL || 'https://mkdb.co';

/**
 * Truncate synopsis on a word‑boundary and append ellipsis.
 * Discord embed description limit is 4096 chars – we keep it small (500).
 */
function truncateSynopsis(text, max = 500) {
  if (!text || text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
}

module.exports = {
  /* Meta used by mkdb/index.js to build the Slash‑command */
  meta: {
    name: 'search',
    description: 'Search MKDb for a film',
    options: [
      {
        name: 'query',
        description: 'Film title to search for',
        type: 3,              // STRING
        required: true,
      },
    ],
  },

  /* Actual handler */
  async execute (interaction) {
    await interaction.deferReply();          // acknowledge immediately
    const query = interaction.options.getString('query');

    /* ── call your backend search endpoint ───────────────────────────── */
    const res   = await fetch(
      `${MKDB_API_BASE}/films/search?query=${encodeURIComponent(query)}`
    );
    if (!res.ok) {
      return interaction.editReply('❌  Server error while searching.');
    }
    const { film, slug } = await res.json();
    if (!film) {
      return interaction.editReply('🔍  No film found.');
    }

    /* ── build rich embed ────────────────────────────────────────────── */
    const embed = new EmbedBuilder()
      .setTitle(`${film.title} (${film.year ?? '—'})`)
      .setURL(`https://mkdb.co/film/${slug}`)
      .setDescription(film.synopsis ? truncateSynopsis(film.synopsis, 500) : '—')
      .setThumbnail(`https://mkdb.co/images/posters/${slug}.jpg`)
      .addFields(
        { name: 'MKDb Rank',          value: film.current_rank ? `#${film.current_rank}` : 'N/A', inline: true },
        { name: 'Average ★',          value: Number(film.average_rating).toFixed(2),    inline: true },
        { name: 'Rating Count',       value: `${film.rating_count}`,            inline: true },
      )
      .setFooter({ text: 'Metropolis Kino Database' });

    return interaction.editReply({ embeds: [embed] });
  }
};