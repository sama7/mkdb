import 'dotenv/config';

/**
 * One bot application serves both communities. Which network a given
 * invocation belongs to is decided by the command name it arrived under —
 * `/mkdb` in the Metropolis guild, `/lkdb` in the Lycan one — because Discord
 * registers commands per guild (see deploy-commands.ts). Everything that
 * differs between the two lives in this object and is threaded through to the
 * subcommands, so there is exactly one implementation of each command.
 */
export type Network = 'metro' | 'lank';

export interface Brand {
    /** Slash command name, and the key used to look the brand back up. */
    command: string;
    /** Display name in embeds and option descriptions. */
    label: string;
    /** Community name, used in the command's own description. */
    community: string;
    network: Network;
    /** Base for /api/discord requests. */
    apiBase: string;
    /** Base for user-facing mkdb.co links. */
    siteBase: string;
    /** Minimum rating count the rankings apply when the user doesn't pass one. */
    defaultMinRatings: number;
}

const API_BASE = process.env.MKDB_API_BASE_URL;
const SITE_BASE = process.env.MKDB_BASE_URL || 'https://mkdb.co';

export const BRANDS: Record<string, Brand> = {
    mkdb: {
        command: 'mkdb',
        label: 'MKDb',
        community: 'Metropolis',
        network: 'metro',
        apiBase: `${API_BASE}`,
        siteBase: SITE_BASE,
        defaultMinRatings: 10,
    },
    lkdb: {
        command: 'lkdb',
        label: 'LKDb',
        community: 'Lycan',
        network: 'lank',
        // Both prefixes mirror the site's own /lank split.
        apiBase: `${API_BASE}/lank`,
        siteBase: `${SITE_BASE}/lank`,
        defaultMinRatings: 5,
    },
};

export const ALL_BRANDS: Brand[] = Object.values(BRANDS);

/** Look up a brand by the command name an interaction arrived under. */
export function brandFor(commandName: string): Brand | undefined {
    return BRANDS[commandName];
}
