import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import pool from '../db/conn.js';
import type { QueryResult } from 'pg';

const SQL_PATH = path.resolve('sql/promote_and_rank.sql');
const POSTER_DIR = path.resolve('images/posters');

export async function runPromote() {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');

    const client = await pool.connect();
    let orphanSlugs: string[] = [];
    try {
        const result = await client.query(sql);
        // node-postgres returns the last command's result for multi-statement queries.
        // The trailing SELECT in promote_and_rank.sql returns the deleted orphan slugs.
        const last = (Array.isArray(result) ? result[result.length - 1] : result) as QueryResult<{ slug?: string }>;
        orphanSlugs = (last?.rows ?? []).map((r) => r.slug).filter(Boolean) as string[];
    } finally {
        client.release();
    }

    console.log(`[promote] SQL completed. ${orphanSlugs.length} orphan films deleted.`);

    let removed = 0, missing = 0, failed = 0;
    for (const slug of orphanSlugs) {
        const p = path.join(POSTER_DIR, `${slug}.jpg`);
        try {
            fs.unlinkSync(p);
            removed++;
        } catch (err) {
            if (err.code === 'ENOENT') missing++;
            else { failed++; console.warn(`[promote] could not unlink ${p}: ${err.message}`); }
        }
    }

    console.log(`[promote] posters: removed=${removed}, already-missing=${missing}, failed=${failed}`);
    return { orphanCount: orphanSlugs.length, postersRemoved: removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runPromote()
        .then(() => pool.end())
        .catch((err) => {
            console.error('[promote] fatal:', err);
            pool.end().finally(() => process.exit(1));
        });
}
