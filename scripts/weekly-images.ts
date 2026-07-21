// Generates the five weekly-update images that get posted to Discord's #mank:
//   1. top 20 ranked films        (from the current metro top-1000)
//   2. top 20 greatest risers
//   3. top 20 greatest fallers
//   4. new entries to the top 1000
//   5. new departures from the top 1000
//
// Each image is a 4-column poster grid rendered server-side with sharp,
// mirroring the look of mkdb.co's homepage and /new page. Posters come from
// images/posters/<slug>.jpg (missing → placeholder SVG, same as the bot's
// poster grid). Text (header + per-poster labels) is drawn via SVG overlays;
// this requires a font installed on the host (see README / deploy notes).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import pool from '../db/conn.js';

const POSTER_DIR = process.env.WEEKLY_POSTER_DIR || path.resolve('images/posters');
const PLACEHOLDER_PATH = path.resolve('images/placeholder-poster.svg');
const ICON_DIR = path.resolve('images/icons');
const FONT_DIR = path.resolve('assets/fonts');
const EMPTY_POSTER_BYTES = 118;

// sharp/librsvg renders SVG text via fontconfig. The VPS has no system fonts,
// so we point fontconfig at the bundled Roboto (assets/fonts) via a generated
// config. Isolating to just the bundled font guarantees identical rendering
// on any host (local dev and prod). Set before the first sharp text render.
function ensureFontconfig(): void {
    if (process.env.MKDB_FONTCONFIG_READY) return;
    const cacheDir = path.join(os.tmpdir(), 'mkdb-fontcache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>`;
    const confPath = path.join(os.tmpdir(), 'mkdb-fonts.conf');
    fs.writeFileSync(confPath, conf);
    process.env.FONTCONFIG_FILE = confPath;
    process.env.MKDB_FONTCONFIG_READY = '1';
}
ensureFontconfig();

// Layout — tuned to resemble the site's poster grid at a legible size.
const COLS = 4;
const CELL_W = 230, CELL_H = 345;      // poster dimensions
const CARD_PAD = 10;                   // padding between card edge and poster
const LABEL_H = 52;                    // label strip height below each poster
const GAP = 16;                        // gap between cards
const HEADER_H = 104;
const OUTER = 18;
const CARD_W = CELL_W + CARD_PAD * 2;
const CARD_H = CELL_H + CARD_PAD + LABEL_H;

const BG = '#242424';
const CARD_BG = '#141414';
const BORDER = 'rgba(255,255,255,0.14)';
const WHITE = 'rgba(255,255,255,0.92)';
const GREEN = '#08c434';
const RED = '#ff4d4d';
const FONT = 'Roboto';
const LABEL_FONT_SIZE = 26;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Measure the rendered pixel width of a run of text by rasterizing it on a
// transparent canvas and trimming to content. SVG can't self-measure, so this
// lets us place the header icon flush against the title regardless of length.
async function measureTextWidth(text: string, fontSize: number, weight: number): Promise<number> {
    const pad = 20;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${fontSize * 2}">` +
        `<text x="${pad}" y="${fontSize}" font-family="${FONT}" font-size="${fontSize}" font-weight="${weight}" fill="#ffffff">${esc(text)}</text>` +
        `</svg>`;
    try {
        const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
        return info.width;
    } catch {
        // trim throws if the canvas is empty (blank text); fall back to estimate
        return text.length * fontSize * 0.55;
    }
}

async function resolvePosterFile(slug: string): Promise<string> {
    const real = path.join(POSTER_DIR, `${slug}.jpg`);
    try {
        const st = await fs.promises.stat(real);
        if (st.size > EMPTY_POSTER_BYTES) return real;
    } catch { /* missing */ }
    return PLACEHOLDER_PATH;
}

export interface GridItem {
    slug: string;
    rank: string;                       // primary label, e.g. "1", "504", "(781)"
    change?: string;                    // secondary label numeric part, e.g. "259"
    changeColor?: string;               // color for `change` + the direction arrow
    dir?: 'up' | 'down';                // draws a ▲/▼ polygon before `change`
}

// Per-character rendered widths at the label font, so we can position the
// rank text / arrow polygon / change number without a sharp measure per
// label. Roboto renders SVG arrow glyphs as tofu on a fontless host, so the
// arrows are drawn as polygons instead — which means we can't lean on a
// single centered <text> and have to lay the pieces out ourselves.
let charWidthCache: Map<string, number> | null = null;
async function charWidths(): Promise<Map<string, number>> {
    if (charWidthCache) return charWidthCache;
    const m = new Map<string, number>();
    for (const c of '0123456789()') {
        m.set(c, await measureTextWidth(c, LABEL_FONT_SIZE, 600));
    }
    charWidthCache = m;
    return m;
}
function textWidth(str: string, widths: Map<string, number>): number {
    let w = 0;
    for (const c of str) w += widths.get(c) ?? LABEL_FONT_SIZE * 0.55;
    return w;
}

export interface RenderOpts {
    title: string;
    iconFile?: string;                  // filename in images/icons composited after the title
    items: GridItem[];
}

export async function renderGridImage({ title, iconFile, items }: RenderOpts): Promise<Buffer> {
    const rows = Math.max(1, Math.ceil(items.length / COLS));
    const width = OUTER * 2 + COLS * CARD_W + (COLS - 1) * GAP;
    const height = OUTER + HEADER_H + rows * CARD_H + (rows - 1) * GAP + OUTER;

    const cellX = (col: number) => OUTER + col * (CARD_W + GAP);
    const cellY = (row: number) => OUTER + HEADER_H + row * (CARD_H + GAP);

    // ---- Back overlay: background, header text, card backgrounds, labels ----
    const widths = await charWidths();
    const cardRects: string[] = [];
    const labelParts: string[] = [];
    // Arrow geometry (drawn as polygons; Roboto has no ▲/▼ glyph).
    const ARROW_W = 15, ARROW_H = 15, GAP_RANK_ARROW = 9, GAP_ARROW_NUM = 5;
    items.forEach((it, i) => {
        const col = i % COLS, row = Math.floor(i / COLS);
        const x = cellX(col), y = cellY(row);
        cardRects.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="6" fill="${CARD_BG}"/>`);

        const labelCenterX = x + CARD_W / 2;
        const labelBaseline = y + CARD_PAD + CELL_H + LABEL_H / 2 + 9;

        if (it.change && it.dir) {
            // rank  ▲/▼  change  — laid out as a centered group.
            const rankW = textWidth(it.rank, widths);
            const numW = textWidth(it.change, widths);
            const total = rankW + GAP_RANK_ARROW + ARROW_W + GAP_ARROW_NUM + numW;
            const left = labelCenterX - total / 2;
            const color = it.changeColor || WHITE;
            labelParts.push(`<text x="${left}" y="${labelBaseline}" font-family="${FONT}" font-size="${LABEL_FONT_SIZE}" font-weight="600" fill="${WHITE}">${esc(it.rank)}</text>`);
            const ax = left + rankW + GAP_RANK_ARROW;
            const ayTop = labelBaseline - 20;   // align arrow with the digits' visual band
            const pts = it.dir === 'up'
                ? `${ax},${ayTop + ARROW_H} ${ax + ARROW_W},${ayTop + ARROW_H} ${ax + ARROW_W / 2},${ayTop}`
                : `${ax},${ayTop} ${ax + ARROW_W},${ayTop} ${ax + ARROW_W / 2},${ayTop + ARROW_H}`;
            labelParts.push(`<polygon points="${pts}" fill="${color}"/>`);
            const numX = ax + ARROW_W + GAP_ARROW_NUM;
            labelParts.push(`<text x="${numX}" y="${labelBaseline}" font-family="${FONT}" font-size="${LABEL_FONT_SIZE}" font-weight="600" fill="${color}">${esc(it.change)}</text>`);
        } else {
            // rank only — centered.
            labelParts.push(`<text x="${labelCenterX}" y="${labelBaseline}" text-anchor="middle" font-family="${FONT}" font-size="${LABEL_FONT_SIZE}" font-weight="600" fill="${WHITE}">${esc(it.rank)}</text>`);
        }
    });

    // Header is horizontally centered. When an icon is present, the whole
    // group (title + gap + icon) is centered as a unit — the title text is
    // left-anchored at the group's left edge and the icon sits after it.
    const ICON_H = 44, ICON_GAP = 14;
    const headerY = OUTER + 62;
    const titleW = await measureTextWidth(title, 40, 700);
    let headerText: string;
    let iconComposite: sharp.OverlayOptions | null = null;

    const iconPath = iconFile ? path.join(ICON_DIR, iconFile) : null;
    if (iconPath && fs.existsSync(iconPath)) {
        const icon = await sharp(iconPath).resize({ height: ICON_H }).toBuffer();
        const iconW = (await sharp(icon).metadata()).width || ICON_H;
        const groupW = titleW + ICON_GAP + iconW;
        const groupLeft = (width - groupW) / 2;
        headerText = `<text x="${groupLeft}" y="${headerY}" font-family="${FONT}" font-size="40" font-weight="700" fill="${WHITE}">${esc(title)}</text>`;
        iconComposite = { input: icon, left: Math.round(groupLeft + titleW + ICON_GAP), top: Math.round(headerY - ICON_H + 6) };
    } else {
        headerText = `<text x="${width / 2}" y="${headerY}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="${WHITE}">${esc(title)}</text>`;
    }

    const backSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<rect width="${width}" height="${height}" fill="${BG}"/>` +
        cardRects.join('') +
        headerText +
        labelParts.join('') +
        `</svg>`,
    );

    // ---- Poster tiles ----
    const posterTiles = await Promise.all(items.map(async (it, i) => {
        const col = i % COLS, row = Math.floor(i / COLS);
        const file = await resolvePosterFile(it.slug);
        const buf = await sharp(file).resize(CELL_W, CELL_H, { fit: 'cover' }).toBuffer();
        return { input: buf, left: cellX(col) + CARD_PAD, top: cellY(row) + CARD_PAD };
    }));

    // ---- Front overlay: thin poster borders ----
    const borderRects = items.map((_, i) => {
        const col = i % COLS, row = Math.floor(i / COLS);
        const x = cellX(col) + CARD_PAD, y = cellY(row) + CARD_PAD;
        return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL_W - 1}" height="${CELL_H - 1}" fill="none" stroke="${BORDER}" stroke-width="1"/>`;
    });
    const frontSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${borderRects.join('')}</svg>`,
    );

    const composites: sharp.OverlayOptions[] = [
        { input: backSvg, left: 0, top: 0 },
        ...posterTiles,
        { input: frontSvg, left: 0, top: 0 },
        ...(iconComposite ? [iconComposite] : []),
    ];

    return sharp({ create: { width, height, channels: 4, background: BG } })
        .composite(composites)
        .png()
        .toBuffer();
}

// ---------------------------------------------------------------------------
// Data layer — pulls the five datasets for the current metro week.
// ---------------------------------------------------------------------------

export async function fetchCurrentWeek(): Promise<number> {
    const { rows } = await pool.query<{ w: number }>(`SELECT MAX(week) AS w FROM film_rankings_history WHERE network='metro'`);
    return rows[0].w;
}

async function fetchRanked(): Promise<GridItem[]> {
    const { rows } = await pool.query<{ ranking: number; slug: string }>(`
        SELECT frh.ranking, f.slug
          FROM film_rankings_history frh JOIN films f USING (film_id)
         WHERE frh.network='metro' AND frh.week=(SELECT MAX(week) FROM film_rankings_history WHERE network='metro')
         ORDER BY frh.ranking ASC LIMIT 20`);
    return rows.map((r) => ({ slug: r.slug, rank: String(r.ranking) }));
}

async function fetchRisers(): Promise<GridItem[]> {
    const { rows } = await pool.query<{ current_rank: number; change: number; slug: string }>(`
        WITH cur AS (SELECT MAX(week) w FROM film_rankings_history WHERE network='metro')
        SELECT c.ranking AS current_rank, (p.ranking - c.ranking) AS change, f.slug
          FROM film_rankings_history c
          JOIN film_rankings_history p ON p.film_id=c.film_id AND p.network='metro' AND p.week=(SELECT w-1 FROM cur)
          JOIN films f ON f.film_id=c.film_id
         WHERE c.network='metro' AND c.week=(SELECT w FROM cur) AND p.ranking > c.ranking
         ORDER BY change DESC LIMIT 20`);
    return rows.map((r) => ({ slug: r.slug, rank: String(r.current_rank), change: String(r.change), changeColor: GREEN, dir: 'up' as const }));
}

async function fetchFallers(): Promise<GridItem[]> {
    const { rows } = await pool.query<{ current_rank: number; change: number; slug: string }>(`
        WITH cur AS (SELECT MAX(week) w FROM film_rankings_history WHERE network='metro')
        SELECT c.ranking AS current_rank, (c.ranking - p.ranking) AS change, f.slug
          FROM film_rankings_history c
          JOIN film_rankings_history p ON p.film_id=c.film_id AND p.network='metro' AND p.week=(SELECT w-1 FROM cur)
          JOIN films f ON f.film_id=c.film_id
         WHERE c.network='metro' AND c.week=(SELECT w FROM cur) AND c.ranking > p.ranking
         ORDER BY change DESC LIMIT 20`);
    return rows.map((r) => ({ slug: r.slug, rank: String(r.current_rank), change: String(r.change), changeColor: RED, dir: 'down' as const }));
}

async function fetchNewEntries(): Promise<GridItem[]> {
    const { rows } = await pool.query<{ current_rank: number; slug: string }>(`
        WITH cur AS (SELECT MAX(week) w FROM film_rankings_history WHERE network='metro')
        SELECT c.ranking AS current_rank, f.slug
          FROM film_rankings_history c JOIN films f ON f.film_id=c.film_id
         WHERE c.network='metro' AND c.week=(SELECT w FROM cur)
           AND NOT EXISTS (SELECT 1 FROM film_rankings_history p WHERE p.film_id=c.film_id AND p.network='metro' AND p.week=(SELECT w-1 FROM cur))
         ORDER BY c.ranking ASC LIMIT 20`);
    return rows.map((r) => ({ slug: r.slug, rank: String(r.current_rank) }));
}

async function fetchNewDepartures(): Promise<GridItem[]> {
    const { rows } = await pool.query<{ previous_rank: number; slug: string }>(`
        WITH cur AS (SELECT MAX(week) w FROM film_rankings_history WHERE network='metro')
        SELECT p.ranking AS previous_rank, f.slug
          FROM film_rankings_history p JOIN films f ON f.film_id=p.film_id
         WHERE p.network='metro' AND p.week=(SELECT w-1 FROM cur)
           AND NOT EXISTS (SELECT 1 FROM film_rankings_history c WHERE c.film_id=p.film_id AND c.network='metro' AND c.week=(SELECT w FROM cur))
         ORDER BY p.ranking ASC LIMIT 20`);
    return rows.map((r) => ({ slug: r.slug, rank: `(${r.previous_rank})` }));
}

export interface WeeklyImage { type: string; filename: string; buffer: Buffer }

export async function generateWeeklyImages(): Promise<WeeklyImage[]> {
    const [ranked, risers, fallers, entries, departures] = await Promise.all([
        fetchRanked(), fetchRisers(), fetchFallers(), fetchNewEntries(), fetchNewDepartures(),
    ]);

    const specs: { type: string; title: string; iconFile?: string; items: GridItem[] }[] = [
        { type: 'ranked', title: 'Top Ranked Films', items: ranked },
        { type: 'risers', title: 'Greatest Risers in Rank', items: risers },
        { type: 'fallers', title: 'Greatest Fallers in Rank', items: fallers },
        { type: 'entries', title: 'Just Entered the Top 1000', iconFile: 'new_mank.png', items: entries },
        { type: 'departures', title: 'Just Left the Top 1000', iconFile: 'former_mank.png', items: departures },
    ];

    const out: WeeklyImage[] = [];
    for (const s of specs) {
        const buffer = await renderGridImage(s);
        out.push({ type: s.type, filename: `${s.type}.png`, buffer });
    }
    return out;
}

// CLI: write the five images to a directory (default /tmp/weekly-out) for review.
if (import.meta.url === `file://${process.argv[1]}`) {
    const outDir = process.argv[2] || '/tmp/weekly-out';
    fs.mkdirSync(outDir, { recursive: true });
    generateWeeklyImages()
        .then(async (imgs) => {
            for (const img of imgs) {
                fs.writeFileSync(path.join(outDir, img.filename), img.buffer);
                console.log(`wrote ${path.join(outDir, img.filename)} (${img.buffer.length} bytes)`);
            }
            await pool.end();
        })
        .catch((err) => { console.error(err); pool.end().finally(() => process.exit(1)); });
}
