import fs from 'fs'
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Adblocker from 'puppeteer-extra-plugin-adblocker';
import { DateTime } from 'luxon';

if (process.argv.length < 3) {
    console.error('Error: Please provide a username.')
    process.exit(1)
}

const USERNAME = process.argv[2]
const URL = `https://letterboxd.com/${USERNAME}/films/rated/.5-5/page/`
const OUTPUT_FILE = `films-${USERNAME}.json`;
puppeteer.use(StealthPlugin());
puppeteer.use(Adblocker({ blockTrackers: true }));

async function scrapeFilms() {
    const start = performance.now();

    const browser = await puppeteer.launch({ headless: 'shell' });

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

    console.log(`Total pages: ${totalPages}`);

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
            let value = null;
            let attempt = 0;

            while (value === null && attempt < maxRetries) {
                value = await element.evaluate((el, attr) => el.getAttribute(attr), attribute);
                if (value === null) {
                    attempt++;
                    const delay = attempt * 500; // Increase delay with each retry (500ms, 1000ms, 1500ms, etc.)
                    console.log(`Attempt ${attempt}: ${attribute} not found, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            const slug = await element.evaluate((el, attr) => el.getAttribute(attr), 'data-film-slug')
            if (value === null) {
                console.warn(`Warning: Attribute ${attribute} was not found for ${slug} after ${maxRetries} attempts`);
            }
            return value;
        };

        // Iterate over each film and extract the required data
        for (const filmElement of filmElements) {
            // Wait for the "data-film-name" attribute to load
            // await page.waitForSelector('.film-poster[data-film-name]');
            // await page.waitForSelector('.film-poster[data-film-release-year]');

            // const title = await filmElement.$eval('.film-poster', el => el.getAttribute('data-film-name'));
            // const year = await filmElement.$eval('.film-poster', el => el.getAttribute('data-film-release-year'));


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

        // const randomDelay = Math.floor(Math.random() * 2000) + 1000; // Random delay between 1-3 seconds
        // await await new Promise(r => setTimeout(r, randomDelay));

        // // Randomize User-Agent
        // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    }
    await browser.close();
    console.log(`Total films: ${films.length}`);
    const finish = performance.now();
    console.log(`Film scraping took ${((finish - start) / 1000).toFixed(2)} seconds`);

    return films
}

scrapeFilms().then(films => {
    const updated_at = DateTime.now();
    const outputData = {
        updated_at,
        count: films.length,
        films
    }

    fs.writeFileSync(`films/${OUTPUT_FILE}`, JSON.stringify(outputData, null, 2))

}).catch(error => {
    console.error('Error scraping films:', error)
})