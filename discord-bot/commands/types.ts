import type {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    Collection,
    SlashCommandBuilder,
    SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

// SlashCommandBuilder narrows to SlashCommandSubcommandsOnlyBuilder
// once .addSubcommand() is chained, so the parent command's `data`
// has to accept either form.
export type CommandBuilderData =
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder;

export interface MkdbCommand {
    data: CommandBuilderData;
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
    /** Optional — only commands with autocompleted options implement this. */
    autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
}

export interface MkdbSubCommand {
    execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

// Tells TypeScript about `client.commands`, which we attach manually
// in index.ts (Client itself doesn't ship with this property).
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, MkdbCommand>;
    }
}
