// Wraps `npm run sync` with a data-driven start-time:
//   start = next midnight − (max of last N syncs' duration) − 30 min buffer
//
// Cron invokes this wrapper much earlier than the actual sync needs to begin
// (see scripts/mkdb.crontab); the wrapper sleeps until the computed start
// time, then spawns the sync. Keeps the sync finishing comfortably before
// promote runs at 00:00 ET on Monday, regardless of how big a given week's
// sync turns out to be.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DUMPS_DIR = join(process.cwd(), 'dumps');
const BUFFER_MS = 30 * 60 * 1000;   // 30-min safety buffer between sync end and midnight
const LOOKBACK = 5;                 // how many prior weekly syncs to consult
const FALLBACK_DURATION_MS = 60 * 60 * 1000;   // assume 1h if no prior logs found

function parseDoneDuration(content: string): number | null {
    // Match the orchestrator's summary line, e.g.:
    //   [sync] done in 1h 9m 48s (...)
    //   [sync] done in 47m 45s (...)
    //   [sync] done in 30s (...)
    for (const line of content.split('\n')) {
        const m = line.match(/\[sync\] done in (?:(\d+)h\s+)?(?:(\d+)m\s+)?(?:(\d+)s)/);
        if (m) {
            const h = parseInt(m[1] || '0', 10);
            const min = parseInt(m[2] || '0', 10);
            const s = parseInt(m[3] || '0', 10);
            return ((h * 60 + min) * 60 + s) * 1000;
        }
    }
    return null;
}

function maxRecentSyncDurationMs(lookback: number): { max: number | null; samples: { file: string; ms: number }[] } {
    let files: string[];
    try {
        files = readdirSync(DUMPS_DIR)
            .filter((f) => /^sync_\d{4}-\d{2}-\d{2}\.log$/.test(f))
            .sort()
            .slice(-lookback);
    } catch {
        return { max: null, samples: [] };
    }

    const samples: { file: string; ms: number }[] = [];
    for (const f of files) {
        const dur = parseDoneDuration(readFileSync(join(DUMPS_DIR, f), 'utf8'));
        if (dur !== null) samples.push({ file: f, ms: dur });
    }

    if (samples.length === 0) return { max: null, samples };
    return { max: Math.max(...samples.map((s) => s.ms)), samples };
}

function nextMidnightMs(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return d.getTime();
}

function fmtMs(ms: number): string {
    if (ms < 0) ms = 0;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return [h ? `${h}h` : null, m ? `${m}m` : null, `${s}s`].filter(Boolean).join(' ');
}

async function main() {
    console.log(`[scheduled-sync] start at ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);

    const { max, samples } = maxRecentSyncDurationMs(LOOKBACK);
    for (const s of samples) {
        console.log(`[scheduled-sync] prior: ${s.file} → ${fmtMs(s.ms)}`);
    }

    const planned = max ?? FALLBACK_DURATION_MS;
    if (max === null) {
        console.log(`[scheduled-sync] no prior sync logs parseable; using fallback budget ${fmtMs(FALLBACK_DURATION_MS)}`);
    } else {
        console.log(`[scheduled-sync] longest of last ${samples.length}: ${fmtMs(planned)}`);
    }

    const midnight = nextMidnightMs();
    const target = midnight - planned - BUFFER_MS;
    const sleep = Math.max(0, target - Date.now());

    console.log(`[scheduled-sync] next midnight: ${new Date(midnight).toLocaleString('en-US', { timeZoneName: 'short' })}`);
    console.log(`[scheduled-sync] buffer: ${fmtMs(BUFFER_MS)}`);
    console.log(`[scheduled-sync] target sync start: ${new Date(target).toLocaleString('en-US', { timeZoneName: 'short' })}`);

    if (sleep > 0) {
        console.log(`[scheduled-sync] sleeping ${fmtMs(sleep)} until then...`);
        await new Promise<void>((resolve) => setTimeout(resolve, sleep));
    } else {
        // longest_prior + 30 min didn't fit between cron-fire and midnight.
        // Run immediately and let the promote-race detection catch any issue.
        console.log(`[scheduled-sync] target is in the past; starting sync immediately (cron fired too late OR last-5 max exceeds available window)`);
    }

    console.log(`[scheduled-sync] launching npm run sync at ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);
    const child = spawn('npm', ['run', 'sync'], { stdio: 'inherit', cwd: process.cwd() });
    const code: number = await new Promise((resolve, reject) => {
        child.on('exit', (c) => resolve(c ?? 0));
        child.on('error', reject);
    });
    process.exit(code);
}

main().catch((err) => {
    console.error('[scheduled-sync] fatal:', err);
    process.exit(1);
});
