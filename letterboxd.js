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

async function scrapeUsernames(browser, client) {
    const followingListURL = 'https://letterboxd.com/metrodb/following/';

    const page = (await browser.pages())[0];
    await page.setViewport({ width: 393, height: 852 });
    await page.goto(followingListURL);

    let usernames = [];
    let pageNum = 1;

    // Loop through all pages
    while (true) {
        // Wait for the table to load
        const followingTableExists = await page.$('table.person-table');

        if (!followingTableExists) {
            break; // Exit if no table is found
        }

        // Get all usernames on the current page
        const pageUsernames = await page.evaluate(() => {
            const rows = document.querySelectorAll('.person-table tr');
            const names = [];

            rows.forEach(row => {
                const avatarLink = row.querySelector('.avatar');
                if (avatarLink) {
                    const href = avatarLink.getAttribute('href');
                    if (href) {
                        // Extract the username between the slashes in the href
                        const username = href.split('/')[1];
                        names.push(username);
                    }
                }
            });
            return names;
        });

        // Insert each username into the database if it doesn't already exist
        for (const username of pageUsernames) {
            try {
                await client.query(
                    `INSERT INTO users (username, time_created, time_modified) 
                     VALUES ($1, NOW(), NOW()) 
                     ON CONFLICT (username) DO NOTHING`,
                    [username]
                );
            } catch (err) {
                console.error(`Failed to insert username ${username}:`, err.stack);
            }
        }

        console.log(`Number of users found on Page ${pageNum}: ${pageUsernames.length}`);

        // Add the usernames from this page to the total list
        usernames = usernames.concat(pageUsernames);

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
    // await page.close();
    console.log(`Total users found: ${usernames.length}`)
    return usernames;
}

async function scrapeFilms(browser, client, username) {
    const start = performance.now();
    const URL = `https://letterboxd.com/${username}/films/rated/.5-5/page/`;

    const page = await browser.newPage();
    // page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.setViewport({ width: 393, height: 852 });

    await page.goto(URL + 1);

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
        await page.goto(URL + i, { waitUntil: 'networkidle0' });

        // Check if there are any films on the page
        const filmsExist = await page.$('ul.poster-list');

        if (!filmsExist) {
            break;
        }

        await page.waitForSelector('.film-poster[data-film-name]');
        await page.waitForSelector('.film-poster[data-film-release-year]');

        // Get the total number of films on the page
        const filmElements = await page.$$('.poster-container');

        // Helper function to wait for a non-null attribute with a retry mechanism
        const waitForAttribute = async (element, attribute, maxRetries = 60) => {
            const slug = await element.evaluate((el, attr) => el.getAttribute(attr), 'data-film-slug')
            let value = null;
            let attempt = 0;

            while (value === null && attempt < maxRetries) {
                value = await element.evaluate((el, attr) => el.getAttribute(attr), attribute);
                if (value === null) {
                    attempt++;
                    const delay = attempt * 500; // Increase delay with each retry (500ms, 1000ms, 1500ms, etc.)
                    console.log(`Attempt ${attempt}: ${attribute} not found for user '${username}' -> film '${slug}', retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            if (value === null) {
                console.warn(`Warning: Attribute ${attribute} was not found for user '${username}' -> film '${slug}' after ${maxRetries} attempts`);
            }
            return value;
        };

        // Iterate over each film and extract the required data
        for (const filmElement of filmElements) {
            const titleElement = await filmElement.$('.film-poster');

            // Wait for non-null values
            const title = await waitForAttribute(titleElement, 'data-film-name');
            let year = await waitForAttribute(titleElement, 'data-film-release-year');
            const permalink = await filmElement.$eval('.film-poster', el => el.getAttribute('data-film-slug'));

            if (year === "") {
                year = null; // Replace empty string with null, as database only accepts integers or null
            }

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

            // Push the extracted data into the films array ()
            films.push({ title, year, rating, permalink });

            // Insert or update film in the database
            const filmInsertQuery = `
                INSERT INTO films (title, year, slug, time_created, time_modified)
                VALUES ($1, $2, $3, NOW(), NOW())
                ON CONFLICT (slug) DO NOTHING
                RETURNING film_id;
            `;
            let filmId;

            try {
                const result = await client.query(filmInsertQuery, [title, year, permalink]);
                filmId = result.rows.length > 0 ? result.rows[0].film_id : null;
            } catch (err) {
                console.error(`Failed to insert film '${permalink}':`, err.stack);
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
                INSERT INTO ratings (user_id, film_id, rating, time_created, time_modified)
                VALUES ((SELECT user_id FROM users WHERE username = $1), $2, $3, NOW(), NOW())
                ON CONFLICT (user_id, film_id) DO UPDATE
                SET rating = EXCLUDED.rating, time_modified = NOW()
                WHERE ratings.rating <> EXCLUDED.rating;
            `;

            try {
                await client.query(ratingInsertQuery, [username, filmId, rating]);
            } catch (err) {
                console.error(`Failed to insert or update rating for film '${permalink}' by user '${username}':`, err.stack);
            }
        }
        // Add a random delay between 1 to 3 seconds before moving on to the next page of films
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, delay))
    }
    await page.close();
    console.log(`Total films for user '${username}': ${films.length}`);
    const finish = performance.now();
    console.log(`Film scraping for user '${username}' took ${((finish - start) / 1000).toFixed(2)} seconds`);
}

async function safeGoto(page, url, options = { waitUntil: 'networkidle0', timeout: 60000 }) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto(url, options);
            return; // Successfully loaded the page
        } catch (err) {
            console.warn(`Attempt ${attempt} failed for ${url}: ${err.message}`);
            if (attempt === 3) throw err; // Re-throw after 3 attempts
        }
    }
}

async function downloadImage(url, dest) {
    const file = fs.createWriteStream(dest);
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function scrapePosters(browser, client) {
    const start = performance.now();
    try {
        // Get all slugs from the films table
        const { rows } = await client.query('SELECT slug FROM films ORDER BY film_id');
        const slugs = rows.map(row => row.slug);
        console.log(`Found ${slugs.length} films to scrape`);

        // IGNORE BELOW CODE: for processing limited batch only
        // const slugs = [
        //     'a-climax-of-blue-power',
        //     'a-womans-torment-1977',
        //     'american-babylon',
        //     'bacchanale-1970',
        //     'bat-pussy',
        //     'bijou',
        //     'bottled-vulva-high-school-girl-yuriko',
        //     'boys-in-the-sand',
        //     'cafe-flesh',
        //     'china-girl-1974',
        //     'corporate-assets',
        //     'drive-1974',
        //     'el-satario',
        //     'equation-to-an-unknown',
        //     'eveready-harton-in-buried-treasure',
        // ];

        // Define the number of concurrent pages (batches of 10)
        const concurrency = 10;

        // Function to process a batch of slugs
        const processBatch = async (batch) => {
            const promises = batch.map(async (slug) => {
                const page = await browser.newPage();
                const URL = `https://letterboxd.com/film/${slug}/`;  // Film page URL

                await safeGoto(page, URL);  // Using the safeGoto function, retries up to 3 times

                // Extract the poster URL
                const posterUrl = await page.evaluate(() => {
                    const posterElement = document.querySelector('img[width="230"][height="345"]');
                    return posterElement ? posterElement.src : null;
                });

                if (posterUrl) {
                    const imagePath = path.resolve(`./images/posters/${slug}.jpg`);
                    await downloadImage(posterUrl, imagePath);
                    console.log(`Downloaded poster for ${slug} to ${imagePath}`);
                } else {
                    console.log(`Poster not found for ${slug}`);
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

            // Add a small delay after each batch of 10 completes
            console.log(`Processed ${i + batch.length} posters. Adding a delay...`);
            const delay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const finish = performance.now();
        console.log(`Scraping ${slugs.length} posters took ${((finish - start) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error('Error scraping posters:', error);
        const finish = performance.now();
        console.log(`Errored out after ${((finish - start) / 1000).toFixed(2)} seconds`);
    }
}

async function main() {
    const start = performance.now();
    const dbUser = process.env.DB_USER || process.env.DEV_DB_USER;
    const dbPassword = process.env.DB_PASSWORD || process.env.DEV_DB_PASSWORD;
    const { Client } = pg;
    const client = new Client({
        user: dbUser,
        password: dbPassword,
        host: 'localhost',
        database: 'mkdb',
        port: process.env.DB_PORT || 5432,
    });
    const browser = await puppeteer.launch({ headless: 'shell' });
    try {
        await client.connect()
            .then(() => console.log('Connected to PostgreSQL database'))
            .catch(err => console.error('Connection error', err.stack));

        const usernames = await scrapeUsernames(browser, client);

        // IGNORE BELOW CODE; for getting a specific range of usernames only
        // particularly if program times out..

        // // Define the SQL query
        // const query = `
        //     SELECT username
        //     FROM users
        //     WHERE user_id >= $1
        //     ORDER BY user_id ASC;
        // `;

        // // Execute the query and store the results in the usernames array
        // let usernames = [];

        // try {
        //     const result = await client.query(query, [203]); // 203 is the starting user_id
        //     usernames = result.rows.map(row => row.username); // Extract the usernames from the result set
        //     console.log(`Fetched ${usernames.length} usernames with user_id >= 203`);
        // } catch (err) {
        //     console.error('Error fetching usernames from the database:', err.stack);
        // }

        // IGNORE BELOW CODE: for running concurrently in batches of 10 only

        // // Helper function to split an array into chunks
        // function chunkArray(array, chunkSize) {
        //     const chunks = [];
        //     for (let i = 0; i < array.length; i += chunkSize) {
        //         chunks.push(array.slice(i, i + chunkSize));
        //     }
        //     return chunks;
        // }

        // // Split the usernames array into chunks of 10
        // const chunks = chunkArray(usernames, 10);
        // console.log(`Splitting users into ${chunks.length} chunks, scraping films of no more than 10 users concurrently`);

        // // Process each chunk sequentially
        // for (const [i, chunk] of chunks.entries()) {
        //     console.log(`=== STARTING CHUNK ${i + 1} WITH ${chunk.length} USERNAMES ===`);
        //     await Promise.all(chunk.map(username => scrapeFilms(browser, username)));
        //     console.log(`=== FINISHED CHUNK ${i + 1} WITH ${chunk.length} USERNAMES ===`);
        // }

        for (const username of usernames) {
            await scrapeFilms(browser, client, username);
            // Add a random delay between 1 to 3 seconds
            const delay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        const finish = performance.now();
        console.log(`Film scraping for all users took ${((finish - start) / 1000).toFixed(2)} seconds`);

        await scrapePosters(browser, client);
    } catch (error) {
        console.error(`Error in main(): ${error}`);
    } finally {
        await client.end();
        console.log('Disconnected from PostgreSQL database');
        await browser.close();
    }
}

main();