import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Adblocker from 'puppeteer-extra-plugin-adblocker';
import fs from 'fs';
import path from 'path';
import https from 'https';
import 'dotenv/config';
import pg from 'pg';

puppeteer.use(StealthPlugin());
puppeteer.use(Adblocker({ blockTrackers: true }));

// Default timeout (ms) when waiting for specific elements to appear
const SELECTOR_TIMEOUT = 12000;   // 12 seconds

async function scrapeUsernames(browser, client) {
    const followingListURL = 'https://letterboxd.com/metrodb/following/';

    const page = (await browser.pages())[0];
    await safeGoto(page, followingListURL);

    let usernames = [];
    let pageNum = 1;

    // Loop through all pages
    while (true) {
        // Wait for the table to load
        const followingTableExists = await page.$('table.member-table');

        if (!followingTableExists) {
            break; // Exit if no table is found
        }

        // Get all usernames and avatar URLs on the current page
        const pageUsernamesAndAvatars = await page.evaluate(() => {
            const rows = document.querySelectorAll('.member-table tbody tr');
            const users = [];

            rows.forEach(row => {
                const user = {};
                const avatarLink = row.querySelector('.avatar');
                if (avatarLink) {
                    const href = avatarLink.getAttribute('href');
                    const avatarSrc = avatarLink.querySelector('img')?.getAttribute('src');
                    if (href) {
                        // Extract the username between the slashes in the href
                        const username = href.split('/')[1];
                        user.username = username;
                        user.avatarSrc = avatarSrc;
                    }
                }
                const nameLink = row.querySelector('h3.title-3 a.name');
                if (nameLink) {
                    const displayName = nameLink.textContent.trim();
                    user.displayName = displayName;
                }
                const numFilmsWatchedLink = row.querySelector('a.icon-watched');
                if (numFilmsWatchedLink) {
                    const numFilmsWatched = parseInt(numFilmsWatchedLink.textContent.trim().replace(/,/g, ''));
                    user.numFilmsWatched = numFilmsWatched;
                }
                users.push(user);
            });
            return users;
        });

        // Insert each username into the database if it doesn't already exist
        for (const user of pageUsernamesAndAvatars) {
            const { username, avatarSrc, displayName, numFilmsWatched } = user;

            try {
                await client.query(
                    `INSERT INTO users_stg (username, display_name, num_films_watched, time_created, time_modified) 
                     VALUES ($1, $2, $3, NOW(), NOW()) 
                     ON CONFLICT (username) DO UPDATE
                     SET display_name = EXCLUDED.display_name, num_films_watched = EXCLUDED.num_films_watched, time_modified = NOW()`,
                    [username, displayName, numFilmsWatched]
                );

                // Download the avatar image to server
                if (avatarSrc) {
                    const dest = path.resolve(`./images/avatars/${username}.jpg`);
                    await downloadImage(avatarSrc, dest);
                } else {
                    console.log(`Avatar not found for ${username}`);
                }

                // Download large avatar image to server
                let avatarLargeSrc;
                await safeGoto(page, `https://letterboxd.com/${username}`);
                avatarLargeSrc = await page.evaluate(() => {
                    return document.querySelector('div.profile-avatar img')?.getAttribute('src');
                });
                if (avatarLargeSrc) {
                    const dest = path.resolve(`./images/avatars/${username}-large.jpg`);
                    await downloadImage(avatarLargeSrc, dest);
                } else {
                    console.log(`Large avatar not found for ${username}`);
                }
                console.log(`Finished scraping user details for '${username}'`);
                // Add a random delay between 5 to 7 seconds before moving on to the next user's profile for downloading large avatar
                const delay = Math.floor(Math.random() * 2000) + 5000;
                await new Promise(resolve => setTimeout(resolve, delay))
            } catch (err) {
                console.error(`Failed to insert username ${username}:`, err.stack);
            }
        }

        console.log(`Number of users found on Page ${pageNum}: ${pageUsernamesAndAvatars.length}`);

        // Add the usernames from this page to the total list
        usernames = usernames.concat(pageUsernamesAndAvatars.map(user => user.username));

        // Navigate back to the Following list page that we were on
        await safeGoto(page, followingListURL + `page/${pageNum}`);

        // Check if there is a "Next" button to go to the next page
        const nextPageLink = await page.$('a.next');
        if (!nextPageLink) {
            break; // Exit loop if no next page is found
        }

        // Increment page number count
        pageNum++;

        // Click on the "Next" link
        await nextPageLink.click();

        // Wait for the next page to load
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
    }
    await page.close();
    console.log(`Total users found: ${usernames.length}`);
    return usernames;
}

async function scrapeFilmRatings(browser, client, username) {
    const start = performance.now();
    const URL = `https://letterboxd.com/${username}/films/rated/.5-5/page/`;

    const page = await browser.newPage();
    // page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.setViewport({ width: 393, height: 852 });

    await page.goto(URL + 1, { timeout: 60000 });

    // Check if the pagination element exists
    const paginationExists = await page.$('div.pagination ul');

    let totalPages = 1; // Default to 1 if pagination doesn't exist

    if (paginationExists) {
        // Extract the total number of pages
        totalPages = await page.evaluate(() => {
            const paginationList = document.querySelector('div.pagination ul');
            const lastPageElement = paginationList.querySelector('li:last-child a');
            return lastPageElement ? parseInt(lastPageElement.textContent.trim(), 10) : 1;
        });
    }

    console.log(`Total pages for user '${username}': ${totalPages}`);

    const films = []

    for (let i = 1; i <= totalPages; i++) {
        console.log(`Starting Page ${i} of ${totalPages} for user '${username}'`);
        try {
            await safeGoto(page, URL + i); // Using the safeGoto function, retries up to 6 times

            // Check if there are any films on the page
            const filmsExist = await page.$('ul.grid');

            if (!filmsExist) {
                break;
            }

            await page.waitForSelector('li.griditem div.react-component[data-item-name]');

            // Get the total number of films on the page
            const filmElements = await page.$$('li.griditem');

            // Helper function to wait for a non-null attribute with a retry mechanism
            const waitForAttribute = async (element, attribute, maxRetries = 3) => {
              // Try to grab a stable identifier for logs
              const slug = element
                ? await element.evaluate(el => el.getAttribute('data-item-slug'))
                : null;
              let value = null;
              let attempt = 0;

              while (value === null && attempt < maxRetries) {
                value = await element?.evaluate((el, attr) => el.getAttribute(attr), attribute);
                if (value === null) {
                  attempt++;
                  const delay = attempt * 500; // 500ms, 1000ms, 1500ms…
                  // console.log(`Attempt ${attempt}: ${attribute} not found for item '${debugHref ?? 'unknown'}', retrying in ${delay}ms...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }

              if (value === null) {
                console.warn(`Warning: Attribute ${attribute} was not found for user '${username}' -> film '${slug ?? 'unknown'}' after ${maxRetries} attempts`);
              }
              return value;
            };

            // Iterate over each film and extract the required data
            for (const filmElement of filmElements) {
                const poster = await filmElement.$('div.react-component[data-component-class*="LazyPoster"]');

                // Wait for non-null values
                const title = await waitForAttribute(poster, 'data-item-name', 3);
                if (title === null) {
                  i--;
                  console.log(`Retrying Page ${i + 1} of ${totalPages} for user '${username}'`);
                  break;
                }

                const permalink = await filmElement.$eval('div.react-component[data-component-class*="LazyPoster"]', el => el.getAttribute('data-item-slug'));

                // Wait for the "rated-x" class to appear within the "poster-viewingdata" element
                const ratingClass = await filmElement.$eval('.poster-viewingdata span[class*="rated-"]', el => {
                    // Extract the class that matches "rated-x"
                    const ratingClass = Array.from(el.classList).find(cls => cls.startsWith('rated-'));
                    return ratingClass || null;
                });

                let rating = 0;
                if (ratingClass) {
                    const ratingValue = parseInt(ratingClass.split('-')[1], 10);
                    rating = ratingValue / 2; // Convert to actual rating (e.g., 10 -> 5.0)
                }

                // Push the extracted data into the films array
                films.push({ title, rating, permalink });

                // Insert or update film in the database
                const filmInsertQuery = `
                INSERT INTO films (title, slug, time_created, time_modified)
                VALUES ($1, $2, NOW(), NOW())
                ON CONFLICT (slug) DO NOTHING
                RETURNING film_id;
            `;
                let filmId;

                try {
                    const result = await client.query(filmInsertQuery, [title, permalink]);
                    filmId = result.rows.length > 0 ? result.rows[0].film_id : null;
                } catch (err) {
                    console.error(`Failed to insert film '${permalink}' for user '${username}':`, err.stack);
                    continue;
                }

                if (!filmId) {
                    // If the film already exists, get its film_id
                    const getFilmIdQuery = `SELECT film_id FROM films WHERE slug = $1`;
                    try {
                        const result = await client.query(getFilmIdQuery, [permalink]);
                        filmId = result.rows[0].film_id;
                    } catch (err) {
                        console.error(`Failed to retrieve film_id for film '${permalink}':`, err.stack);
                        continue;
                    }
                }

                // Insert or update rating in the database
                const ratingInsertQuery = `
                INSERT INTO ratings_stg (user_id, film_id, rating, time_created, time_modified)
                VALUES ((SELECT user_id FROM users_stg WHERE username = $1), $2, $3, NOW(), NOW())
                ON CONFLICT (user_id, film_id) DO UPDATE
                SET rating = EXCLUDED.rating, time_modified = NOW()
                WHERE ratings_stg.rating <> EXCLUDED.rating;
            `;

                try {
                    await client.query(ratingInsertQuery, [username, filmId, rating]);
                } catch (err) {
                    console.error(`Failed to insert or update rating of film '${permalink}' for user '${username}':`, err.stack);
                }
            }
        } catch (err) {
            console.error(`Failed to load Page ${i} of ${totalPages} for user '${username}':`, err.message);
        }
        // console.log(`Finished Page ${i} of ${totalPages} for user '${username}'`);
        // // Add a random delay between 1 to 3 seconds before moving on to the next page of films
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, delay))
    }
    await page.close();
    const finish = performance.now();
    const timeToScrape = (finish - start) / 1000; // in seconds
    const scrapingSpeed = films.length / timeToScrape;
    console.log(`Scraping ${films.length} films for user '${username}' took ${timeToScrape.toFixed(2)} seconds: ${scrapingSpeed.toFixed(2)} films/second`);
}

async function safeGoto(page, url, options = { waitUntil: 'networkidle0', timeout: 60000 }) {
    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await page.goto(url, options);
            return; // Successfully loaded the page
        } catch (err) {
            console.warn(`Attempt ${attempt} failed for ${url}: ${err.message}`);
            // Add a delay before retrying (5–7 seconds)
            // "exponential" backoff strategy: delay increases with each attempt
            const delay = Math.floor(Math.random() * 2000 * attempt) + 5000;
            await new Promise(resolve => setTimeout(resolve, delay))
            if (attempt === 10) throw err; // Re-throw after 10 attempts
        }
    }
}

async function downloadImage(url, dest) {
    const file = fs.createWriteStream(dest);
    return new Promise((resolve, reject) => {
        function fetchUrl(currentUrl) {
            https.get(currentUrl, (response) => {
                // Check if the response is a redirect (status codes 301, 302, etc.)
                if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        console.log(`Redirecting to ${redirectUrl}`);
                        fetchUrl(redirectUrl); // Follow the redirect
                        return;
                    }
                }
                // If the response is not a redirect, pipe the response to the file
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err)); // Delete the incomplete file on error
            });
        }
        // Start fetching the initial URL
        fetchUrl(url);
    });
}

async function scrapeFilmDetails(browser, client) {
    const start = performance.now();
    try {
        // Incremental scrape: only new films added in the recent lookback window
        // or rows that are still missing any of the key details. Configure the
        // lookback (in days) via DETAILS_LOOKBACK_DAYS; defaults to 7.
        const lookbackDays = Number(process.env.DETAILS_LOOKBACK_DAYS || 7);
        const { rows } = await client.query(
            `
            SELECT slug
            FROM films
            WHERE
                time_created >= NOW() - ($1 || ' days')::interval
                OR tmdb IS NULL
                OR synopsis IS NULL
                OR year IS NULL
                OR runtime IS NULL
                OR array_length(genres, 1) IS NULL
                OR array_length(directors, 1) IS NULL
                OR array_length(countries, 1) IS NULL
                OR array_length(languages, 1) IS NULL
            ORDER BY film_id DESC
            `,
            [lookbackDays]
        );
        const slugs = rows.map(row => row.slug);
        console.log(`Found ${slugs.length} films to scrape (new in last ${lookbackDays}d or missing details)`);

        // IGNORE BELOW CODE: for processing limited batch only
        /*
        const slugs = [
            'silent-waters',
            'the-text-of-light',
            'the-matrix',
            'the-longest-day',
        ];
        */

        // Define the number of concurrent pages (batches of 30)
        const concurrency = 30;

        // Function to process a batch of slugs
        const processBatch = async (batch) => {
            const promises = batch.map(async (slug) => {
                const page = await browser.newPage();
                const URL = `https://letterboxd.com/film/${slug}/`;  // Film page URL

                await safeGoto(page, URL);  // Using the safeGoto function, retries up to 6 times

                // make sure runtime footer has rendered
                await page.waitForSelector('p.text-footer', { timeout: SELECTOR_TIMEOUT }).catch(() => { });

                // Extract the poster URL, TMDb URL, and synopsis
                const { posterUrl, tmdbUrl, synopsis, year, runtime } = await page.evaluate(() => {
                    const posterElement = document.querySelector('img[width="230"][height="345"]');
                    const tmdbElement = document.querySelector('a[href^="https://www.themoviedb.org/"]');
                    const synopsisElement = document.querySelector('meta[name="description"]');
                    const yearElement = document.querySelector('span.releasedate a');
                    const footerText = document.querySelector('p.text-footer')?.innerText || '';
                    const runtimeMatch = footerText.match(/(\d+)\s*min(?:s)?/);   // match "1 min" or "55 mins"

                    return {
                        posterUrl: posterElement ? posterElement.src : null,
                        tmdbUrl: tmdbElement ? tmdbElement.href : null,
                        synopsis: synopsisElement ? synopsisElement.content : null,
                        year: yearElement ? yearElement.textContent.trim() : null,
                        runtime: runtimeMatch ? Number(runtimeMatch[1]) : null,
                    };
                });

                try {
                    // Download poster image if it exists
                    if (posterUrl) {
                        const imagePath = path.resolve(`./images/posters/${slug}.jpg`);
                        await downloadImage(posterUrl, imagePath);
                        console.log(`Downloaded poster for ${slug} to ${imagePath}`);
                    } else {
                        console.log(`Poster not found for ${slug}`);
                    }
                } catch (err) {
                    console.error(`Failed to fetch poster for ${slug}:`, err.message);
                }

                // ── directors ────────────────────────────────────────────────
                const crewURL = `https://letterboxd.com/film/${slug}/crew/`;
                let directors = [];
                try {
                    await safeGoto(page, crewURL);
                    // wait until the director list (text‑sluglist) is present or we bail out
                    await page.waitForSelector('#tab-crew div.text-sluglist', { timeout: SELECTOR_TIMEOUT }).catch(() => { });
                    directors = await page.evaluate(() => {
                        const header = Array.from(document.querySelectorAll('#tab-crew h3 span.crewrole'))
                            .find(span => /Director/i.test(span.textContent));
                        if (!header) return [];
                        const listDiv = header.parentElement.nextElementSibling; // .text-sluglist
                        return Array.from(listDiv.querySelectorAll('a.text-slug'))
                            .map(a => a.textContent.trim());
                    });
                } catch (err) {
                    console.error(`Failed to fetch directors for ${slug}:`, err.message);
                }

                // Now scrape the genres from the /genres/ page
                const genresURL = `https://letterboxd.com/film/${slug}/genres/`;
                let genres = [];
                try {
                    await safeGoto(page, genresURL);
                    await page.waitForSelector('#tab-genres div.text-sluglist', { timeout: SELECTOR_TIMEOUT });

                    // Extract genres from the page
                    genres = await page.evaluate(() => {
                        const genreHeader = Array.from(document.querySelectorAll('h3'))
                            .find(h3 => /Genre(s)?/.test(h3.textContent));  // Find the h3 containing "Genre" or "Genres"

                        if (!genreHeader) return [];  // No genres found

                        const genreDiv = genreHeader.nextElementSibling;  // The div immediately following the genre header
                        if (!genreDiv) return [];

                        const genreLinks = Array.from(genreDiv.querySelectorAll('p a'));  // Get the <a> links inside <p> tags
                        const genres = genreLinks.map(a => a.textContent.trim());

                        return genres;
                    });
                } catch (err) {
                    console.error(`Failed to fetch genres for ${slug}:`, err.message);
                }

                // ── details page (countries, languages) ──────────────
                const detailsURL = `https://letterboxd.com/film/${slug}/details/`;
                let countries = [], languages = [];
                try {
                    await safeGoto(page, detailsURL);
                    // ensure the details sluglist is loaded
                    await page.waitForSelector('#tab-details div.text-sluglist', { timeout: SELECTOR_TIMEOUT }).catch(() => { });

                    ({ countries, languages } = await page.evaluate(() => {
                        // helper that returns text[] from the div that follows an <h3><span>label</span>
                        function grabList(labelRegex) {
                            const span = Array.from(document.querySelectorAll('#tab-details h3 span'))
                                .find(s => labelRegex.test(s.textContent));
                            if (!span) return [];
                            const listDiv = span.parentElement.nextElementSibling;
                            return Array.from(listDiv.querySelectorAll('a.text-slug'))
                                .map(a => a.textContent.trim());
                        }

                        const countries = grabList(/Countr/i);

                        // languages: primary + spoken
                        let languages = grabList(/^Language$/i);
                        const primary = grabList(/Primary Language/i);
                        const spoken = grabList(/Spoken Languages/i)
                            .map(txt => txt.split(',')[0].trim());   // drop after first comma
                        if (primary.length) languages = primary;
                        spoken.forEach(l => { if (!languages.includes(l)) languages.push(l); });

                        return { countries, languages };
                    }));
                } catch (err) {
                    console.error(`Failed to fetch countries/languages details for ${slug}:`, err.message);
                }

                // Update the database with the TMDb URL, synopsis, and genres
                try {
                    await client.query(
                        `UPDATE films 
                            SET tmdb = $1, 
                                synopsis = $2, 
                                year = $3,
                                genres = $4,
                                runtime = $5,
                                directors = $6,
                                countries = $7,
                                languages = $8,
                                time_modified = NOW() 
                        WHERE slug = $9`,
                        [tmdbUrl, synopsis, year, genres, runtime, directors, countries, languages, slug]
                    );
                    console.log(`Updated film details for ${slug}`);
                } catch (err) {
                    console.error(`Failed to update details for ${slug}:`, err.stack);
                }

                await page.close();
            });

            // Wait for all promises in the batch to complete
            await Promise.all(promises);
        };

        // Process the slugs in batches
        for (let i = 0; i < slugs.length; i += concurrency) {
            const batch = slugs.slice(i, i + concurrency);
            await processBatch(batch);

            // Add a small delay after each batch of 30 completes
            console.log(`Processed ${i + batch.length} of ${slugs.length} film details. Adding a delay...`);
            const delay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const finish = performance.now();
        const timeToScrape = (finish - start) / 1000;
        console.log(`Scraping ${slugs.length} film details took ${timeToScrape.toFixed(2)} seconds`);
    } catch (error) {
        console.error('Error scraping film details:', error);
        const finish = performance.now();
        const timeToScrape = (finish - start) / 1000;
        console.log(`Errored out after ${timeToScrape.toFixed(2)} seconds`);
    }
}

async function main() {
    const start = performance.now();
    const dbUser = process.env.DB_USER || process.env.DEV_DB_USER;
    const dbPassword = process.env.DB_PASSWORD || process.env.DEV_DB_PASSWORD;
    const { Pool } = pg;
    const client = new Pool({
        user: dbUser,
        password: dbPassword,
        host: 'localhost',
        database: 'mkdb',
        max: 30,
        port: process.env.DB_PORT || 5432,
    });
    let browser;
    if (process.env.NODE_ENV === 'production') {
        // specify chromium path for ubuntu
        browser = await puppeteer.launch({
            headless: 'shell',
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            protocolTimeout: 120000, // 2 minutes timeout
        })
    } else {
        browser = await puppeteer.launch({ headless: 'shell' });
    }
    try {
        await client.connect()
            .then(() => console.log('Connected to PostgreSQL database'))
            .catch(err => console.error('Connection error', err.stack));

        const usernames = await scrapeUsernames(browser, client);

        // IGNORE BELOW CODE; for getting a specific range of usernames only
        // particularly if program times out..
        /*
                // Define the SQL query
                const query = `
                    SELECT username
                    FROM users_stg
                    WHERE user_id = $1
                    ORDER BY user_id ASC;
                `;
        
                // Execute the query and store the results in the usernames array
                let usernames = [];
        
                try {
                    const result = await client.query(query, [1612]); // 203 is the starting user_id
                    usernames = result.rows.map(row => row.username); // Extract the usernames from the result set
                    console.log(`Fetched ${usernames.length} usernames with user_id = 1612`);
                } catch (err) {
                    console.error('Error fetching usernames from the database:', err.stack);
                }
        */

        // IGNORE BELOW CODE: for running concurrently in batches of 10 only. 
        // unless that's what you want to do 😳 then uncomment the below

        // Helper function to split an array into chunks
        function chunkArray(array, chunkSize) {
            const chunks = [];
            for (let i = 0; i < array.length; i += chunkSize) {
                chunks.push(array.slice(i, i + chunkSize));
            }
            return chunks;
        }

        // Split the usernames array into chunks of 10
        const chunks = chunkArray(usernames, 10);
        console.log(`Splitting users into ${chunks.length} chunks, scraping film ratings of no more than 10 users concurrently`);

        // Process each chunk sequentially
        for (const [i, chunk] of chunks.entries()) {
            console.log(`=== STARTING CHUNK ${i + 1} OF ${chunks.length} WITH ${chunk.length} USERNAMES ===`);
            await Promise.all(chunk.map(username => scrapeFilmRatings(browser, client, username)));
            console.log(`=== FINISHED CHUNK ${i + 1} OF ${chunks.length} WITH ${chunk.length} USERNAMES ===`);
        }

        // IGNORE BELOW CODE: comment it out if you are scraping film ratings of 10 users concurrently!
        // uncomment the below code if you are going one-by-one
        /*
                for (const username of usernames) {
                    await scrapeFilmRatings(browser, client, username);
                    // Add a random delay between 1 to 3 seconds
                    const delay = Math.floor(Math.random() * 2000) + 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
        */

        const finish = performance.now();
        const timeToScrape = (finish - start) / 1000;
        console.log(`Scraping of film ratings for all users took ${timeToScrape.toFixed(2)} seconds`);

        await scrapeFilmDetails(browser, client);
        return;
    } catch (error) {
        console.error(`Error in main(): ${error}`);
    } finally {
        await client.end();
        console.log('Disconnected from PostgreSQL database');
        await browser.close();
    }
}

main();