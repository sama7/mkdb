import express from 'express';
import path from 'path';
const __dirname = path.resolve();
import 'dotenv/config';
import filmRoutes from './routes/filmRoutes.js';
import cors from 'cors';

const app = express();
const production = 'https://www.mkdb.co';
const development = 'http://localhost:5173';
const base_url = (process.env.NODE_ENV ? production : development);

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

// Routes
app.use('/api/films', filmRoutes);

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