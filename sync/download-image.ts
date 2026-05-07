import fs from 'fs';
import https from 'https';

export function downloadImage(url: string, dest: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        function fetchUrl(currentUrl: string) {
            https.get(currentUrl, (response) => {
                const statusCode = response.statusCode ?? 0;
                if ([301, 302, 303, 307, 308].includes(statusCode)) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        fetchUrl(redirectUrl);
                        return;
                    }
                }
                if (statusCode >= 400) {
                    file.destroy();
                    fs.unlink(dest, () => reject(new Error(`HTTP ${statusCode} for ${currentUrl}`)));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => file.close(() => resolve()));
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        }
        fetchUrl(url);
    });
}
