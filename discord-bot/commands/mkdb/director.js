const { runContributor } = require('./_contributor');

module.exports = {
  meta: {
    name: 'director',
    description: 'Search MKDb by director',
    options: [
      {
        name: 'query',
        description: "Director's name",
        type: 3,
        required: true,
      },
    ],
  },

  async execute(interaction) {
    return runContributor(interaction, 'Director', 'Director');
  },
};
