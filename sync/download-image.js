import fs from 'fs';
import https from 'https';

export function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        function fetchUrl(currentUrl) {
            https.get(currentUrl, (response) => {
                if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        fetchUrl(redirectUrl);
                        return;
                    }
                }
                if (response.statusCode >= 400) {
                    file.destroy();
                    fs.unlink(dest, () => reject(new Error(`HTTP ${response.statusCode} for ${currentUrl}`)));
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
