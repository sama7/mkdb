import type { ChatInputCommandInteraction } from 'discord.js';

import type { MkdbSubCommand } from '../types.js';
import type { Brand } from './_brand.js';
import { runContributor } from './_contributor.js';

const subcommand: MkdbSubCommand = {
    async execute(interaction: ChatInputCommandInteraction, brand: Brand) {
        return runContributor(interaction, brand, 'Director', 'Director');
    },
};

export default subcommand;
