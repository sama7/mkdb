const express = require('express');
const app = express();
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: './config.env' });
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
//const authorizeRouter = require('./routes/authorize');
const noteRouter = require('./routes/note');
const compression = require('compression');
const port = process.env.PORT || 4000;
// const production = 'https://www.playlistnotes.io';
const development = 'http://localhost:5173';
const base_url = (process.env.NODE_ENV ? production : development);

app.use(express.json());
app.use(express.static(path.join(__dirname, "client", "build")));
app.use(cors({
    credentials: true,
    origin: base_url,
    exposedHeaders: 'Retry-After',
}));
app.use(cookieParser());
app.use(helmet());
app.use(
    helmet.contentSecurityPolicy({
        useDefaults: true,
        directives: {
            "img-src": ["'self'", "https: data:"]
        }
    })
);

app.use(compression());
app.use('/api/', authorizeRouter);
app.use('/api/note', noteRouter);
// get driver connection
const dbo = require('./db/conn');

if (process.env.NODE_ENV === 'production') {
    app.get("*", (req, res) => {
        res.sendFile(path.join(__dirname, "client", "build", "index.html"));
    });
}

app.listen(port, () => {
    // perform a database connection when server starts
    dbo.connectToServer(function (err) {
        if (err) console.error(err);
    });
    console.log(`Server is running on port: ${port}`);
});