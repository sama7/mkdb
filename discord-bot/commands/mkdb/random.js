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
  meta: {
    name: 'random',
    description: 'Get a random film from the MKDb top 1000',
  },

  async execute(interaction) {
    await interaction.deferReply();

    const scope = (interaction.options.getString('scope') || 'top1000').toLowerCase();

    // ── decide which bucket we are drawing from ──────────────────────────────
    let topFilmScope;      // how many ranks we can pick from
    let apiPathBase;       // which API endpoint to hit

    switch (scope) {
      case 'ultramank':               // top‑250 (“Ultra‑MANK”)
        topFilmScope = 250;
        apiPathBase  = '/films/rank/';       // existing endpoint
        break;

      case 'nearmank':                // top‑50 high‑average films w/ 7‑9 ratings
        topFilmScope = 50;
        apiPathBase  = '/films/nearmank/';   // **new** endpoint
        break;

      default:                        // 'top1000'
        topFilmScope = 1000;
        apiPathBase  = '/films/rank/';
    }

    // pick a random rank inside that scope
    const rank = Math.floor(Math.random() * topFilmScope) + 1;

    // ── fetch film details ───────────────────────────────────────────────────
    const res = await fetch(`${MKDB_API_BASE}${apiPathBase}${rank}`);
    if (!res.ok) return interaction.editReply('❌  Could not fetch that rank.');

    const { film } = await res.json();
    if (!film) return interaction.editReply('Rank not found in the selected list.');

    const embed = new EmbedBuilder()
      .setTitle(`${film.title} (${film.year ?? '—'})`)
      .setURL(`${MKDB_BASE_URL}/film/${film.slug}`)
      .setDescription(film.synopsis ? truncateSynopsis(film.synopsis, 500) : '—')
      .setThumbnail(`https://mkdb.co/images/posters/${film.slug}.jpg`)
      .addFields(
        { name: 'MKDb Rank', value: film.current_rank ? `#${film.current_rank}` : 'N/A', inline: true },
        { name: 'Average ★', value: Number(film.average_rating).toFixed(2), inline: true },
        { name: 'Rating Count', value: `${film.rating_count}`, inline: true },
      )
      .setFooter({ text: 'Metropolis Kino Database' });

    return interaction.editReply({ embeds: [embed] });
  }
};