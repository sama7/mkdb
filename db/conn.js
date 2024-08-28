import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'samah',
    password: process.env.DEV_DB_PASSWORD,
    host: 'localhost',
    database: 'mkdb',
    port: process.env.DB_PORT || 5432,
});

export default pool;