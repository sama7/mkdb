import type { ChatInputCommandInteraction } from 'discord.js';

import type { MkdbSubCommand } from '../types.js';
import { runContributor } from './_contributor.js';

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction) {
        return runContributor(interaction, 'Actor', 'Actor');
    },
};

export default subcommand;
