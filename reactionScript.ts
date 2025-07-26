// reactionScript.ts
// This script automates logging into LinkedIn and scraping reactions from a specific post.

import { chromium, Page, expect, Locator } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
import { createObjectCsvWriter } from 'csv-writer'; // Import for CSV writing functionality

// Load environment variables from the .env file.
// This allows sensitive information like login credentials to be kept separate
// from the code and not committed to version control.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Define the directory where Playwright will store user data (cookies, local storage, etc.).
// This enables persistent sessions, so you don't have to log in manually every time
// after the first successful login.
const USER_DATA_DIR: string = path.join(__dirname, 'user_data');

// Retrieve login credentials and URLs from environment variables.
const loginEmail: string = process.env.LINKEDIN_USERNAME!;
const loginPassword: string = process.env.LINKEDIN_PASSWORD!;
const loginURL: string = process.env.LINKEDIN_LOGIN_URL!;
// This URL serves as both the initial navigation target for login and the specific post URL for scraping.
const feedURL: string = process.env.LINKEDIN_FEED_URL!;

// Selector for an element typically visible on the LinkedIn feed after a successful login.
// Used to verify if a user is already logged in or if login was successful.
const LOGGED_IN_SELECTOR = "img[class='global-nav__me-photo evi-image ember-view']";

// Regex to check if the LINKEDIN_FEED_URL in the .env file is still the placeholder URL.
// This is a helpful warning to ensure the user provides a real post URL for scraping.
const LINKEDIN_POST_URL_REGEX = new RegExp(`^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:activity:\d{19}$`);

// Define the interface for the data structure that will be written to the CSV file.
// This provides type safety and clarity for the scraped reaction records.
interface LinkedInReactionRecord {
    index: number;
    reactionType: string;
    userName: string;
    currentRole: string;
    profileLink: string;
}

/**
 * Main function to handle user login and manage the browser session.
 * It attempts to reuse an existing session if available, otherwise prompts for manual login.
 */
async function main() {
    console.log('Launching browser to wait for user login...');
    // Launch a persistent browser context, which means Playwright will reuse the same
    // user profile data (cookies, local storage) across runs.
    const browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false, // Browser must be visible for manual interaction (login).
        args: ['--start-maximized'] // Optional: Maximize the browser window on launch.
    });

    let page: Page;
    // Check if there's already an open page in the persistent context.
    // This prevents opening an extra new tab if a session is being reused.
    const existingPages = browserContext.pages();
    if (existingPages.length > 0) {
        page = existingPages[0]; // Reuse the first existing page/tab.
        console.log('Reusing existing page in the persistent context.');
    } else {
        page = await browserContext.newPage(); // Create a new page/tab if none exist.
        console.log('No existing page found, created a new one.');
    }

    // Navigate to the LinkedIn feed/post URL. This is the starting point for login check.
    await page.goto(feedURL);
    console.log('Checking login status...');

    let isLoggedIn = false;
    try {
        // Wait for a selector that indicates a logged-in state.
        // If it appears within 5 seconds, assume user is already logged in.
        await page.waitForSelector(LOGGED_IN_SELECTOR, { state: 'visible', timeout: 5000 });
        isLoggedIn = true;
        console.log('Already logged in. Reusing existing session.');
    } catch (error) {
        // If the selector is not found, user is not logged in or session expired.
        console.log('Not logged in or session expired. Please log in manually in the opened browser window.');
        // Navigate to the specific LinkedIn login page if not already there.
        if (!page.url().includes('/login')) {
            await page.goto(loginURL);
        }

        // Locate and fill the username input box.
        const usernameInputBox = page.locator("input[id='username']");
        if (await usernameInputBox.isVisible()) {
            await usernameInputBox.click();
            await usernameInputBox.fill(loginEmail);
        } else {
            console.log('Username input box not visible. Assuming pre-filled or different login flow.');
        }

        // Locate and fill the password input box.
        const passwordInputBox = page.locator("input[id='password']");
        await passwordInputBox.click();
        await passwordInputBox.fill(loginPassword);

        // Locate and click the sign-in button.
        const submitButton = page.locator("button[aria-label='Sign in']");
        await submitButton.click();

        console.log('Waiting for you to complete the login...');
        console.log('Looking for selector:', LOGGED_IN_SELECTOR);

        try {
            // Wait indefinitely (timeout: 0) until the logged-in selector appears.
            // This allows the user ample time to complete any multi-factor authentication or captchas.
            await page.waitForSelector(LOGGED_IN_SELECTOR, { state: 'visible', timeout: 0 });
            isLoggedIn = true;
            console.log('Login detected! You are now logged in.');
            // After successful login, if the browser is not on the target feed URL, navigate to it.
            // This handles cases where LinkedIn redirects to a different page after login.
            if (page.url() !== feedURL) {
                 console.log(`Navigating to target feed URL: ${feedURL} after login confirmation.`);
                 await page.goto(feedURL);
            }
        } catch (loginError) {
            console.error('Login wait timed out or failed:', loginError);
            console.error('Please ensure you logged in correctly and the selector is still valid.');
        }
    }

    // Proceed with scraping if login was successful.
    if (isLoggedIn) {
        await extractValue(page);
    } else {
        console.log('Could not confirm login. Exiting.');
    }

    console.log('Automation complete. You can close the browser manually if it paused.');
    // Keep the browser open after script completion for inspection.
    // Uncomment the line below when testing this script
    // await page.pause();

    // Uncomment the line below to automatically close the browser after execution.
    await browserContext.close();
}

/**
 * Extracts reaction data from the specified LinkedIn post.
 * Assumes the page is already navigated to the target post URL.
 * @param page The Playwright Page object to interact with.
 */
async function extractValue(page: Page) {
    console.log('Proceeding with automation tasks...');

    const postUrlForScraping = feedURL; // The target post URL for scraping reactions.

    // Warns the user if the placeholder URL is still in use.
    if (LINKEDIN_POST_URL_REGEX.test(postUrlForScraping)) {
        console.warn('WARNING: Your LINKEDIN_FEED_URL in .env is still the placeholder. Please update it with a real LinkedIn post URL to scrape reactions.');
    }
    console.log(`Currently on post URL: ${postUrlForScraping}`);

    // Click the button that opens the reactions modal.
    await page.locator("button[class*='social-details-reactors-facepile__reactions-modal-button']").click();
    console.log('Clicked the reaction button');

    // Locate the scrollable container of the reactions modal.
    const scrollable = await page.locator("div[class='artdeco-modal__content social-details-reactors-modal__content ember-view']");
    // Locate the unordered list containing the reaction entries.
    const ulElement = await page.locator("ul[class='artdeco-list artdeco-list--offset-1']");
    // Locate all list items (individual reaction entries) within the unordered list.
    const liElement = await ulElement.locator('li');
    // Assert that at least the first reaction entry is visible.
    await expect(liElement.first()).toBeVisible();

    // Scroll the reactions list to load all lazy-loaded content.
    // The fixedWaitAfterScrollMs (1000ms) will be used for stabilization after each scroll.
    await scrollLazyLoadedListUntilComplete(scrollable, 1000, 300);
    console.log('Finished scrolling all lazy-loaded items.');

    // Get all the loaded reaction list elements after scrolling.
    const allLiElements = await liElement.all();
    console.log(`Total ${allLiElements.length} reaction entries found after scrolling.`);

    const records: LinkedInReactionRecord[] = []; // Array to store all scraped reaction data.

    // Iterate through each reaction entry to extract details.
    for (let i = 0; i < allLiElements.length; i++) {
        const indexedElement = allLiElements[i]; // The current list item element.

        // Extract user name, handling cases where it might not be found.
        const userNameVal = await indexedElement.locator("span[class='text-view-model']").textContent().catch(() => null);
        const userName = userNameVal ? userNameVal.trim() : '';

        // Extract current role, with error handling and a timeout.
        let currentRole = '';
        try {
            const currentRoleLocator = indexedElement.locator("div[class='artdeco-entity-lockup__caption ember-view']");
            // Use waitFor with state 'attached' to give the element time to appear, but don't fail hard if it's missing.
            await currentRoleLocator.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
            const currentRoleVal = await currentRoleLocator.textContent();
            currentRole = currentRoleVal ? currentRoleVal.trim() : '';
        } catch (e) {
            // console.warn(`Could not find current role for element ${i}:`, e);
        }

        // Extract profile link, with error handling and a timeout.
        let profileLink = '';
        try {
            const profileLinkLocator = indexedElement.locator("a[class='link-without-hover-state ember-view']");
            await profileLinkLocator.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
            const profileLinkVal = await profileLinkLocator.getAttribute('href');
            profileLink = profileLinkVal ? profileLinkVal.trim() : '';
        } catch (e) {
            // console.warn(`Could not find profile link for element ${i}:`, e);
        }

        // Extract reaction type from image alt text, with error handling and a timeout.
        let imgAltText = '';
        try {
            const imgAltTextLocator = indexedElement.locator("img[data-test-reactions-icon-size='small']");
            await imgAltTextLocator.waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
            const imgAltTextVal = await imgAltTextLocator.getAttribute('alt');
            imgAltText = imgAltTextVal ? imgAltTextVal.trim() : '';
        } catch (e) {
            // console.warn(`Could not find reaction image alt text for element ${i}:`, e);
        }

        // Create a data record object and push it to the records array.
        const record: LinkedInReactionRecord = {
            index: i + 1,
            reactionType: imgAltText,
            userName: userName,
            currentRole: currentRole,
            profileLink: profileLink,
        };
        records.push(record);

        console.log(`${i + 1} | ${imgAltText} | ${userName} | ${currentRole} | ${profileLink}`);
    }

    // Call the function to write the collected records to a CSV file.
    await writeLinkedInRecordsToCsv(records);
}

/**
 * Writes an array of LinkedInReactionRecord objects to a CSV file.
 * @param records The array of data objects to write.
 */
async function writeLinkedInRecordsToCsv(records: LinkedInReactionRecord[]): Promise<void> {
    const csvFileName = 'linkedin_reactions_data.csv';
    const csvFilePath = path.join(__dirname, csvFileName);

    // Configure the CSV writer with the output path and header mapping.
    const csvWriter = createObjectCsvWriter({
        path: csvFilePath,
        header: [
            { id: 'index', title: 'Index' },
            { id: 'reactionType', title: 'Reaction Type' },
            { id: 'userName', title: 'User Name' },
            { id: 'currentRole', title: 'Current Role' },
            { id: 'profileLink', title: 'Profile Link' },
        ],
    });

    try {
        await csvWriter.writeRecords(records); // Write the array of records to CSV.
        console.log(`\nSuccessfully wrote ${records.length} reaction records to ${csvFilePath}`);
    } catch (error) {
        console.error(`Error writing data to CSV at ${csvFilePath}:`, error);
    }
}

/**
 * Scrolls a lazy-loaded list within a container until no new content appears.
 * It repeatedly scrolls to the bottom and waits for the scroll height to stabilize.
 * @param scrollableContainerLocator The Locator for the scrollable HTML element.
 * @param fixedWaitAfterScrollMs The fixed time to wait after each scroll for content to load (in milliseconds). This is now the stabilization wait.
 * @param maxScrollAttempts The maximum number of times to attempt scrolling.
 */
async function scrollLazyLoadedListUntilComplete(
    scrollableContainerLocator: Locator,
    fixedWaitAfterScrollMs: number = 1000, // Default time to wait after each scroll for content to load
    maxScrollAttempts: number = 300
): Promise<void> {
    let previousScrollHeight = -1; // Stores the scroll height from the previous iteration.
    let currentScrollAttempt = 0;   // Tracks the number of scroll attempts.
    let consecutiveSameHeightCount = 0; // Count how many times scrollHeight remained the same
    const maxConsecutiveSameHeight = 3; // How many times to see same height before concluding end

    console.log(`Starting to scroll lazy-loaded list...`);

    // Wait for the scrollable container to be visible before starting.
    await scrollableContainerLocator.waitFor({ state: 'visible', timeout: 30000 });

    // Loop to continuously scroll until no new content loads or max attempts are reached.
    while (currentScrollAttempt < maxScrollAttempts) {
        // Get the current scroll height before performing the scroll action.
        const currentScrollHeightBeforeScroll: number = await scrollableContainerLocator.evaluate((node: HTMLElement) => node.scrollHeight);

        // Scroll the container to its very bottom.
        await scrollableContainerLocator.evaluate((node: HTMLElement) => {
            node.scrollTop = node.scrollHeight;
        });

        console.log(
            `Scroll attempt ${currentScrollAttempt + 1}: scrolled to bottom. ScrollHeight before scroll: ${currentScrollHeightBeforeScroll}`
        );

        // Wait for a fixed duration to allow new content to render and scrollHeight to update.
        // This acts as a stabilization period.
        await scrollableContainerLocator.page().waitForTimeout(fixedWaitAfterScrollMs);
        console.log(`Waited for ${fixedWaitAfterScrollMs}ms for content to render.`);

        // Get the scroll height after the scroll and the wait period.
        const currentScrollHeightAfterWait: number = await scrollableContainerLocator.evaluate((node: HTMLElement) => node.scrollHeight);
        console.log(`ScrollHeight after wait = ${currentScrollHeightAfterWait}.`);

        // Check if the scroll height has increased.
        if (currentScrollHeightAfterWait > currentScrollHeightBeforeScroll) {
            console.log('ScrollHeight increased. More content loaded.');
            consecutiveSameHeightCount = 0; // Reset counter if new content appeared
            // Update previousScrollHeight to the new maximum if it actually grew.
            previousScrollHeight = currentScrollHeightAfterWait;
        } else {
            // Scroll height did not increase. This indicates we might be at the end.
            consecutiveSameHeightCount++;
            console.log(`ScrollHeight did not increase. Consecutive same height count: ${consecutiveSameHeightCount}`);

            // If scrollHeight has remained the same for a few consecutive attempts,
            // we can confidently assume we've reached the end.
            if (consecutiveSameHeightCount >= maxConsecutiveSameHeight && currentScrollHeightAfterWait > 0) {
                console.log(`ScrollHeight has remained unchanged for ${maxConsecutiveSameHeight} consecutive attempts. Assuming end of list.`);
                break; // Exit the loop
            }
        }

        currentScrollAttempt++; // Increment the scroll attempt counter.
    }

    console.log(`Finished scrolling. Total attempts: ${currentScrollAttempt}.`);
    // Warn if the maximum scroll attempts were reached, indicating potential incomplete loading.
    if (currentScrollAttempt >= maxScrollAttempts) {
        console.warn(`Reached maximum scroll attempts (${maxScrollAttempts}). It's possible not all items were loaded.`);
    }
}

// Execute the main function to start the automation process.
main();