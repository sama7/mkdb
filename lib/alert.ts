/**
 * Critical-alert email for the MKDb batch jobs and health check.
 *
 * Why email over HTTPS and not SMTP: the droplet has no MTA installed and
 * DigitalOcean blocks outbound 25/587, so anything SMTP-shaped silently fails.
 * Port 443 is open, so alerts go out through a provider's HTTP API instead.
 *
 * Configuration (all from .env — the recipient address is deliberately not in
 * the repo):
 *   ALERT_EMAIL_TO        recipient
 *   ALERT_EMAIL_FROM      sender, must be on a domain verified with the provider
 *   ALERT_EMAIL_API_KEY   provider API key
 *   ALERT_EMAIL_ENDPOINT  optional; defaults to Resend's send endpoint
 *
 * This is for *critical* alerts only — a human is expected to act on every one
 * of these, so anything routine belongs in the run log instead.
 */
import 'dotenv/config';

const ENDPOINT = process.env.ALERT_EMAIL_ENDPOINT || 'https://api.resend.com/emails';
const TO = process.env.ALERT_EMAIL_TO;
const FROM = process.env.ALERT_EMAIL_FROM;
const API_KEY = process.env.ALERT_EMAIL_API_KEY;

export interface AlertResult {
    sent: boolean;
    reason?: string;
}

/** True when the alert path is fully configured; false means alerts are dead. */
export function alertsConfigured(): boolean {
    return Boolean(TO && FROM && API_KEY);
}

/**
 * Send a critical alert. Never throws — an alert failing must not take down the
 * job that was trying to report a problem. Failures are logged loudly instead,
 * so they still land in the run log the cron job captures.
 */
export async function sendCriticalAlert(subject: string, body: string): Promise<AlertResult> {
    const stamped = `[alert] ${subject}`;
    // Always mirror to the log, so the alert text survives even if send fails.
    console.error(`${stamped}\n${body}`);

    if (!alertsConfigured()) {
        const reason = 'ALERT_EMAIL_TO / ALERT_EMAIL_FROM / ALERT_EMAIL_API_KEY not all set in .env';
        console.error(`[alert] NOT SENT — ${reason}`);
        return { sent: false, reason };
    }

    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: FROM,
                to: [TO],
                subject: `[MKDb] ${subject}`,
                text: body,
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            const reason = `${res.status} ${await res.text()}`;
            console.error(`[alert] send failed: ${reason}`);
            return { sent: false, reason };
        }
        console.log(`[alert] emailed: ${subject}`);
        return { sent: true };
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[alert] send threw: ${reason}`);
        return { sent: false, reason };
    }
}
