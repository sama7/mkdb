require('dotenv').config();
const { EmbedBuilder, escapeMarkdown } = require('discord.js');
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

/**
 * Convert runtime in minutes → “Hh Mm” / “Hh” / “Mm”.
 * Returns empty string when runtime is nullish or 0.
 */
function formatRuntime(mins = 0) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m)   return `${h}h ${m}m`;
  if (h)        return `${h}h`;
  return `${m}m`;
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
    const res = await fetch(
      `${MKDB_API_BASE}/films/search?query=${encodeURIComponent(query)}`
    );

    // Try to parse JSON even when the status is not 200
    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      // Backend gave us a structured error
      if (payload?.code === 'NO_LETTERBOXD_RESULT') {
        return interaction.editReply(`🔍  No film found for \`${query}\`. Please check your spelling.`);
      }
      if (payload?.code === 'NOT_ON_MKDB') {
        return interaction.editReply(
          `We found a film, but it's not on MKDb. That means none of us have rated it yet. ` +
          `Please try sending the command: \`!f ${query}\``
        );
      }
      console.log('MKDb search error:', payload);
      // Fallback for any other error
      return interaction.editReply('❌  Server error while searching.');
    }

    // Successful response; destructure the expected payload
    const { film, slug } = payload || {};
    if (!film) {
      // This should not happen, but guard just in case
      return interaction.editReply('❌  Unexpected response from server.');
    }

    // Build description: directors → genres → countries → languages → runtime → synopsis
    const descParts = [];

    if (Array.isArray(film.directors) && film.directors.length) {
      descParts.push(film.directors.join(', '));
    }
    if (Array.isArray(film.genres) && film.genres.length) {
      descParts.push(film.genres.join(', '));
    }
    if (Array.isArray(film.countries) && film.countries.length) {
      descParts.push(film.countries.join(', '));
    }
    if (Array.isArray(film.languages) && film.languages.length) {
      descParts.push(film.languages.join(', '));
    }
    const rt = formatRuntime(film.runtime);
    if (rt) descParts.push(rt);

    if (film.synopsis) {
      descParts.push('');
      descParts.push(truncateSynopsis(film.synopsis, 500));
    }

    /* ── build rich embed ────────────────────────────────────────────── */
    const embed = new EmbedBuilder()
      .setTitle(`*${escapeMarkdown(film.title)}* (${film.year ?? '—'})`)
      .setURL(`${MKDB_BASE_URL}/film/${slug}`)
      .setDescription(descParts.join('\n') || '—')
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