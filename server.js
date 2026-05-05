import express from 'express';
import path from 'path';
const __dirname = path.resolve();
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import filmRoutes from './routes/filmRoutes.js';
import discordRoutes from './routes/discordRoutes.js';
import cors from 'cors';

const app = express();
const production = 'https://mkdb.co';
const development = 'http://localhost:5173';
const base_url = (process.env.NODE_ENV ? production : development);

// Trust nginx (one hop) so req.ip reflects the real client, not 127.0.0.1.
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// IPs that should never be rate-limited: loopback, plus anything the
// operator adds (e.g. the server's own public IP, since the prod bot
// calls mkdb.co and comes back through nginx).
const TRUSTED_IPS = new Set([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    ...(process.env.RATE_LIMIT_SKIP_IPS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
]);
const skipTrusted = (req) => TRUSTED_IPS.has(req.ip);

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skipTrusted,
});

// Stricter limit for endpoints that hit Letterboxd or run sharp.
const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: skipTrusted,
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "client", "dist")));
app.use(cors({
    credentials: true,
    origin: base_url,
    exposedHeaders: 'Retry-After',
}));
// Serve static files from the 'images' directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Apply general rate limit to all API routes, plus a stricter limit on
// the expensive endpoints (registered before the route handlers run).
app.use('/api', apiLimiter);
app.use('/api/discord/films/by-contributor', expensiveLimiter);
app.use('/api/discord/posters-grid', expensiveLimiter);

// Routes
app.use('/api', filmRoutes);
app.use('/api/discord', discordRoutes);

// Error handling middleware (optional)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

if (process.env.NODE_ENV === 'production') {
    app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
    });
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});