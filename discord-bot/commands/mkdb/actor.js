const { runContributor } = require('./_contributor');

module.exports = {
  meta: {
    name: 'actor',
    description: 'Search MKDb by actor',
    options: [
      {
        name: 'query',
        description: "Actor's name",
        type: 3,
        required: true,
      },
    ],
  },

  async execute(interaction) {
    return runContributor(interaction, 'Actor', 'Actor');
  },
};
