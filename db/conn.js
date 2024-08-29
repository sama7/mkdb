import pg from 'pg';
const { Pool } = pg;

const dbUser = process.env.DB_USER || process.env.DEV_DB_USER;
const dbPassword = process.env.DB_PASSWORD || process.env.DEV_DB_PASSWORD;
const pool = new Pool({
    user: dbUser,
    password: dbPassword,
    host: 'localhost',
    database: 'mkdb',
    port: process.env.DB_PORT || 5432,
});

export default pool;