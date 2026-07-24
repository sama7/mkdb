import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * sharp/librsvg renders SVG text through fontconfig. The VPS has no system
 * fonts installed, so anything that draws text has to point fontconfig at the
 * fonts bundled in assets/ (Roboto for text, Inter for the ▲/▼ glyphs Roboto
 * lacks). Isolating to just those guarantees identical output on any host.
 *
 * Safe to call repeatedly — the work happens once per process.
 */
const FONT_DIR = path.resolve('assets/fonts');

export function ensureFontconfig(): void {
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
