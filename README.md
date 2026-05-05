# mkdb

A film-ranking site for the **Metropolis** Letterboxd community on Discord. Live at **[mkdb.co](https://mkdb.co)**.

mkdb pulls weekly Letterboxd ratings from everyone the [metrodb](https://letterboxd.com/metrodb/) account follows, computes pairwise user-similarity scores from rating overlap, and produces a community ranking that updates every Monday. Members can browse top films, week-over-week risers/fallers/new-entries, and "neighbor" pages comparing two members' tastes side-by-side.

## How it works

1. **Discover.** Enumerate metrodb's followings into `users_stg` via the Letterboxd API.
2. **Ratings.** For each member, page their rated films into `ratings_stg`, stubbing new films into `films`.
3. **Film details.** For films we've never seen before (`details_fetched_at IS NULL`), fetch full metadata + poster JPG. Existing films are skipped — details are fetched once and reused.
4. **Promote.** In one transaction: TRUNCATE+INSERT live `users` and `ratings` from staging, recompute `user_similarity_scores` (overlap-weighted average rating distance), append a new week to `film_rankings_history`, trim history to the last 3 weeks, and delete orphan films + their poster files.

## Tech stack

- **Backend:** Node.js (ES modules) + Express + `pg` driver
- **Database:** PostgreSQL 16
- **Frontend:** React + Vite + react-bootstrap + react-router-dom (in [`client/`](client/))
- **Discord bot:** mankbot — Discord.js slash commands that call the `/api/discord/*` endpoints (CommonJS, in [`discord-bot/`](discord-bot/))
- **Data source:** [Letterboxd API](https://api-docs.letterboxd.com/) (HMAC-SHA256 signed requests, client-credentials Bearer token)
- **Process management:** pm2 (`server`, `mankbot`)
- **Reverse proxy:** nginx → Node on `localhost:3000`

## Project layout

```
mkdb/
├── server.js                 # Express entrypoint
├── routes/
│   ├── filmRoutes.js         # /api/* — site routes
│   └── discordRoutes.js      # /api/discord/* — Discord bot routes
├── controllers/
│   ├── filmController.js
│   └── discordController.js
├── db/conn.js                # pg Pool (reads DB_USER / DB_PASSWORD)
├── sync/                     # Weekly Letterboxd → DB pipeline
│   ├── index.js              #   orchestrator: discover → ratings → films → promote
│   ├── lbx-client.js         #   HMAC signer + token cache + rate-limited fetch
│   ├── discover-members.js   #   enumerate metrodb's followings
│   ├── sync-ratings.js       #   page each member's ratings into ratings_stg
│   ├── sync-films.js         #   fetch detail + poster for new films
│   └── download-image.js     #   shared HTTPS-with-redirect downloader
├── scripts/promote.js        # runs sql/promote_and_rank.sql + unlinks orphan posters
├── sql/
│   ├── 001_schema_for_api.sql        # one-time API-migration ALTERs
│   └── promote_and_rank.sql          # the promote transaction
├── client/                   # React + Vite frontend
├── discord-bot/              # mankbot — Discord.js slash commands
├── images/
│   ├── posters/<slug>.jpg    # film posters (one-shot download, served by Express)
│   └── avatars/<username>.jpg, <username>-large.jpg
└── dumps/                    # sync logs (`sync_YYYY-MM-DD.log`)
```

## Database schema

Key tables (all live in the `mkdb` database):

| Table | Purpose |
|---|---|
| `films` | Film metadata. PK `film_id`, unique `slug` and `letterboxd_id`. `details_fetched_at` gates re-fetching. |
| `users` | Community members. PK `user_id`, unique `username` and `letterboxd_id`. |
| `ratings` | `UNIQUE (user_id, film_id)`, `rating numeric(2,1) CHECK 0.5–5.0`. |
| `user_similarity_scores` | `(user_a, user_b)`, `overlap_count`, `avg_rating_distance`, `similarity_score`. Symmetric. |
| `film_rankings_history` | `(film_id, week)`. Monotonic `week` counter; trimmed to last 3 weeks on each promote. |
| `users_stg`, `ratings_stg` | Staging mirrors. Truncated at start of each sync, swapped in by promote. |

## Environment variables

Copy [`.env.example`](.env.example) to `.env` at the repo root and fill in the values:

```bash
# Letterboxd API (https://api-docs.letterboxd.com/)
LETTERBOXD_CLIENT_ID=
LETTERBOXD_CLIENT_SECRET=

# PostgreSQL
DB_USER=                  # production
DB_PASSWORD=
DEV_DB_USER=              # local dev fallback (db/conn.js falls back to these)
DEV_DB_PASSWORD=
DB_PORT=5432

# Express
PORT=3000
NODE_ENV=                 # set to "production" on the VPS
RATE_LIMIT_SKIP_IPS=      # optional, comma-separated IPs exempt from rate limiting (loopback already exempt)
```

The Discord bot has its own [`discord-bot/.env.example`](discord-bot/.env.example) — copy it to `discord-bot/.env` and fill in `DISCORD_TOKEN`, `clientId`, `guildId`, `MKDB_API_BASE_URL`, and `MKDB_BASE_URL`.

## Local development

The site needs two processes running: Node serves the API + images on port 3000, and the Vite dev server serves the React SPA on port 5173. Vite proxies `/api/*` and `/images/*` through to Node so the SPA sees a unified origin. The Discord bot is a third optional process — only needed if you're working on the bot.

```bash
# 1. Backend
npm install
npm start                 # http://localhost:3000  (API + /images)

# 2. Frontend (separate terminal)
cd client
npm install
npm run dev               # http://localhost:5173  (SPA, with hot reload)

# 3. Discord bot (optional, separate terminal)
cd discord-bot
npm install
node deploy-commands.js   # one-time: register slash commands with Discord
node index.js             # run the bot
```

The frontend deep-links — `/film/:slug`, `/members/:username`, `/members/:a/:b` — work in both dev and prod.

**In production there's no Vite dev server** — only the static bundle it produces. The deploy step is `cd client && npm run build`, which writes the optimized SPA to `client/dist/`. Node then serves that bundle via the `*` catchall in [server.js](server.js), alongside the API routes and `/images/*` static files. nginx sits in front and proxies all traffic to Node on `localhost:3000`. So Vite is a build-time tool in prod, not a runtime one.

## Weekly sync

Manual cadence (Sunday night into Monday). The orchestrator runs all four stages in order; `sync/index.js` truncates staging at the start so the run is self-contained.

```bash
# Locally
npm run sync 2>&1 | tee dumps/sync_$(date +%F).log

# On the VPS
nohup npm run sync > dumps/sync_$(date +%F).log 2>&1 &
```

Throughput: ~120 films/min for full detail fetches (measured during the initial backfill of ~59k films, which took ~9 hours). Steady-state weekly syncs should be much faster — only genuinely new films hit the detail endpoint (`details_fetched_at IS NULL`); the rest is just paginating each member's ratings.

## API endpoints

Site routes (mounted at `/api`, see [`routes/filmRoutes.js`](routes/filmRoutes.js)):

| Route | Description |
|---|---|
| `GET /rankings` | Top film rankings with optional filters |
| `GET /film/:slug` | Film details + ratings histogram |
| `GET /risers`, `/fallers` | Week-over-week ranking changes |
| `GET /new-entries`, `/new-departures` | Films entering/leaving the top list |
| `GET /members` | Paginated community members |
| `GET /members/:username` | Member profile + their rating distribution |
| `GET /member/:username` | Member's nearest neighbors |
| `GET /neighbors/:a/:b` | Side-by-side neighbor comparison |
| `GET /neighbors-agreed/:a/:b` | Films two neighbors rated similarly |
| `GET /neighbors-differ/:a/:b` | Films two neighbors disagreed on |
| `GET /evil-mank` | Bottom-ranked films (inverse of `/rankings`) |

Routes the Discord bot consumes (mounted at `/api/discord`, see [`routes/discordRoutes.js`](routes/discordRoutes.js)):

| Route | Description |
|---|---|
| `GET /films/search?query=…` | Resolve a search term to a slug + film payload |
| `GET /films/rank/:rank` | Film at the given top-rankings position |
| `GET /films/nearmank/:rank` | Film at the given near-mank position (7–9 ratings, top 100) |
| `GET /films/ratings?query=…` | Search a film and return its ratings histogram |
| `GET /films/by-contributor?query=…&type=Director\|Actor` | Films by a director or actor, joined against MKDb |
| `GET /posters-grid?slugs=…` | 4×2 JPEG composite of up to 8 film posters, generated on-demand by `sharp` |

### Rate limits

External clients are rate-limited per IP via [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit):

- **100 req/min** for any `/api/*` route
- **30 req/min** for `/api/discord/films/by-contributor` and `/api/discord/posters-grid` (these hit the Letterboxd API and run `sharp`)

Loopback (`127.0.0.1`, `::1`) is exempt — that's how mankbot reaches the API in prod, by calling `http://localhost:3000` directly. Add comma-separated IPs to `RATE_LIMIT_SKIP_IPS` to exempt others. Pagination endpoints also cap `?limit=N` at 500.

## Discord bot

mankbot exposes a single `/mkdb` slash command with subcommands. All replies are paginated embeds with ⏮ ◀ ▶ ⏭ buttons where applicable.

| Command | Description |
|---|---|
| `/mkdb search query:<text>` | Search MKDb for a film |
| `/mkdb rank number:<1–1000>` | Film at the given MKDb rank |
| `/mkdb random scope:<top1000\|ultramank\|nearmank>` | Random film from the chosen bucket |
| `/mkdb ratings query:<text>` | Show community ratings for a film |
| `/mkdb director query:<text>` | Films directed by someone, matched against MKDb |
| `/mkdb actor query:<text>` | Films an actor appeared in, matched against MKDb |

`/mkdb director` and `/mkdb actor` page through the person's contributions on Letterboxd, intersect with MKDb, and present each page as a card with the contributor photo as a thumbnail plus a 4×2 poster composite (rendered by the `posters-grid` endpoint and uploaded as a Discord file attachment, so no public image URL is required).

## Production

Hosted on a DigitalOcean droplet. Process management with pm2:

```bash
pm2 list                  # server (Node) + mankbot (Discord)
pm2 logs server           # tail Node logs
pm2 restart server
```

PostgreSQL runs locally on the droplet (UNIX socket, peer auth). nginx terminates TLS (Let's Encrypt) and reverse-proxies all traffic — including `/images/*` and the SPA HTML — to Node on `localhost:3000`. Posters and avatars are served from disk by Express's static middleware (`app.use('/images', express.static(...))`); the React `client/dist` bundle is served the same way.

**nginx forwarded-headers:** the `location /` block in the vhost forwards client identity so the rate limiter sees real IPs (without these, Express sees every request as coming from `127.0.0.1` and skips the limit):

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

Express trusts one proxy hop (`app.set('trust proxy', 1)` in [`server.js`](server.js)) when `NODE_ENV=production`.

**Bot's API base URL:** on the VPS, `discord-bot/.env` sets `MKDB_API_BASE_URL=http://localhost:3000/api/discord` so mankbot reaches the API via loopback — faster (no nginx round-trip) and rate-limit-exempt.

**SSH access:** key-only (Ed25519). Password authentication is disabled, root login is `prohibit-password`. fail2ban watches the systemd journal and bans IPs after repeated SSH failures.

## License

ISC.
