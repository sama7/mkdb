import { promises as fs } from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Adblocker from 'puppeteer-extra-plugin-adblocker';
import { DateTime } from 'luxon';

puppeteer.use(StealthPlugin());
puppeteer.use(Adblocker({ blockTrackers: true }));

async function getUsernames(browser) {
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

async function scrapeFilms(browser, username) {
    const start = performance.now();
    const URL = `https://letterboxd.com/${username}/films/rated/.5-5/page/`
    const OUTPUT_FILE = `films-${username}.json`;

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
            const year = await waitForAttribute(titleElement, 'data-film-release-year');


            const permalink = await filmElement.$eval('.film-poster', el => el.getAttribute('data-film-slug'));

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
            films.push({ title, year, rating, permalink });
        }
    }
    await page.close();
    console.log(`Total films for user '${username}': ${films.length}`);

    const updated_at = DateTime.now();
    const outputData = {
        updated_at,
        count: films.length,
        films
    }

    await fs.writeFile(`films/${OUTPUT_FILE}`, JSON.stringify(outputData, null, 2));

    const finish = performance.now();
    console.log(`Film scraping for user '${username}' took ${((finish - start) / 1000).toFixed(2)} seconds`);
}

async function main() {
    try {
        const start = performance.now();
        const browser = await puppeteer.launch({ headless: 'shell' });
        const usernames = await getUsernames(browser);

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
        console.log(`Splitting users into ${chunks.length} chunks, scraping films of no more than 10 users concurrently`);

        // Process each chunk sequentially
        for (const [i, chunk] of chunks.entries()) {
            console.log(`=== STARTING CHUNK ${i + 1} WITH ${chunk.length} USERNAMES ===`);
            await Promise.all(chunk.map(username => scrapeFilms(browser, username)));
            console.log(`=== FINISHED CHUNK ${i + 1} WITH ${chunk.length} USERNAMES ===`);
        }

        await browser.close();
        const finish = performance.now();
        console.log(`Film scraping for all users took ${((finish - start) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error(`Error in main(): ${error}`);
    }
}

main();

// getUsernames()
//     .then(usernames => console.log(usernames))
//     .catch(error => console.error(`Error getting usernames: ${error}`));

// gonna fix this after i export following list to get array of username URLs
// scrapeFilms().then(films => {


// }).catch(error => {
//     console.error('Error scraping films:', error)
// })