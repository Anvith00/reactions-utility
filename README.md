# Reactions Utility Documentation

This document explains the functionality, structure, and usage of the provided TypeScript script designed to collect reactions from web-based posts, specifically LinkedIn posts in its current configuration.

-----

### 1\. Overview

This script automates the process of logging into a specified social platform (currently LinkedIn, or reusing an existing session), navigating to a specified post, opening the reactions modal, scrolling through all lazy-loaded reactions, extracting details of each reactor (reaction type, user name, current role, profile link), and finally saving this data into a CSV file.

Its primary goal is to reliably **collect all reaction data**, especially from posts with a large number of reactions where content is loaded dynamically as the user scrolls.

-----

### 2\. Prerequisites

Before running this script, ensure you have the following set up:

  * **Node.js:** Installed on your system.
  * **Playwright:** The Playwright library and its browser binaries are installed. You can install it via npm:
    ```bash
    npm install @playwright/test
    npx playwright install
    ```
  * **`dotenv`:** For managing environment variables.
    ```bash
    npm install dotenv
    ```
  * **`csv-writer`:** For writing data to CSV files.
    ```bash
    npm install csv-writer
    npm install --save-dev @types/csv-writer # For TypeScript type definitions
    ```
  * **TypeScript:** You will need the TypeScript compiler (`tsc`) installed.
    ```bash
    npm install -g typescript # To compile .ts files to .js
    ```
  * **.env file:** A file named `.env` in the project's root directory. This file will store your platform credentials and the target post URL for security and flexibility. (Refer to `dotenv_template` in the project root for an example).

-----

### 3\. Project Structure

```
project-root/
├── .env                  <-- Your environment variables go here
├── dist/                 <-- Compiled JavaScript output and session data are stored here
│   ├── user_data/        <-- Directory created by Playwright for session data
│   ├── reactionScript.js <-- Transpiled JavaScript script
│   └── linkedin_reactions_data.csv <-- Output CSV file
├── dotenv_template
├── node_modules
├── package.json
├── package-lock.json
├── README.md             <-- This documentation file
├── tsconfig.json (if applicable)
└── reactionScript.ts   <-- The main script file, in TypeScript
```

-----

### 4\. Configuration (`.env` file)

Create a `.env` file in your project's root directory with the following content. **Replace the placeholder values with your actual LinkedIn credentials and the specific post URL.**

```env
LINKEDIN_USERNAME="your_linkedin_email@example.com"
LINKEDIN_PASSWORD="your_linkedin_password"
LINKEDIN_LOGIN_URL="https://www.linkedin.com/login"
LINKEDIN_FEED_URL="https://www.linkedin.com/feed/update/urn:li:activity:YOUR_POST_ID_HERE/"
```

**Important:**

  * `LINKEDIN_FEED_URL`: This must be the **exact URL of the LinkedIn post** you want to collect reactions from. It typically looks like `https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789/`. The script includes a warning if the placeholder URL is still detected.
  * **Security:** Never commit your `.env` file to version control (e.g., Git repositories). **Always add `.env` to your `.gitignore` file.**

-----

### 5\. Script Constants and Variables

The script defines several constants and variables that control its behavior:

  * `USER_DATA_DIR`:
      * **Type:** `string`
      * **Value:** `path.join(__dirname, 'user_data')`
      * **Purpose:** Specifies the directory where Playwright will store browser user data (cookies, local storage, cached sessions). This allows the script to **reuse your login session** across multiple runs, preventing you from having to log in manually every time after the first successful login.
  * `loginEmail`, `loginPassword`, `loginURL`, `feedURL`:
      * **Type:** `string`
      * **Value:** Retrieved from environment variables (`process.env.LINKEDIN_USERNAME!`, etc.).
      * **Purpose:** Store your account credentials, the general login page URL, and the specific post URL to target for data collection.
  * `LOGGED_IN_SELECTOR`:
      * **Type:** `string`
      * **Value:** `"img[class='global-nav__me-photo evi-image ember-view']"`
      * **Purpose:** A CSS selector for an element that is reliably visible on the LinkedIn feed *only when a user is logged in*. This helps the script **check login status** and wait for the login process to complete.
  * `LINKEDIN_POST_URL_REGEX`:
      * **Type:** `RegExp`
      * **Value:** `/^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:activity:\d{19}$/`
      * **Purpose:** A regular expression used to **validate** if the `LINKEDIN_FEED_URL` in your `.env` file is in the expected LinkedIn post URL format, warning you if it's still a generic placeholder.

-----

### 6\. Interfaces

  * `LinkedInReactionRecord`:
      * **Purpose:** Defines the structure of each row of data that will be written to the CSV file. This ensures type safety and clarity for the collected information.
      * **Properties:**
          * `index: number`: The sequential number of the reaction (1, 2, 3...).
          * `reactionType: string`: The type of reaction (e.g., "Like", "Celebrate", "Love", "Insightful") extracted from the image's alt text.
          * `userName: string`: The full name of the user who reacted.
          * `currentRole: string`: The user's current job title or role, often including their company.
          * `profileLink: string`: The direct URL to the user's profile.

-----

### 7\. Functions

#### 7.1. `main()`

  * **Purpose:** This is the **entry point** of the script. It orchestrates the entire automation flow, from launching the browser to initiating the data collection process.
  * **Workflow:**
    1.  Launches a **persistent browser context** using `chromium.launchPersistentContext(USER_DATA_DIR, ...)`. This is crucial for reusing login sessions.
    2.  Checks for existing pages within the context; reuses one if found, otherwise creates a new page.
    3.  Navigates to the `feedURL` (your target post).
    4.  **Login Check:** Attempts to `waitForSelector(LOGGED_IN_SELECTOR)` for 5 seconds.
          * If the selector appears, it assumes you're already logged in (reusing a session).
          * If it times out, it proceeds with the manual login flow:
              * Navigates to `loginURL`.
              * Fills in `username` and `password` fields using values from `.env`.
              * Clicks the "Sign in" button.
              * Then, it `waitForSelector(LOGGED_IN_SELECTOR, { timeout: 0 })` indefinitely, prompting you to manually complete any MFA, CAPTCHA, or other login challenges in the opened browser window.
              * Once logged in, it navigates back to the `feedURL` if necessary.
    5.  If login is successful (`isLoggedIn` is true), it calls `extractValue(page)` to start data collection.
    6.  After `extractValue` completes, the browser remains open (via `page.pause()`) for inspection. You can uncomment `browserContext.close()` to close it automatically.

#### 7.2. `extractValue(page: Page)`

  * **Purpose:** Contains the **core logic** for interacting with the post and extracting reaction data. This function assumes the `page` is already authenticated and navigated to the correct `feedURL`.
  * **Workflow:**
    1.  Logs the target post URL and warns if it's still the placeholder.
    2.  Locates and clicks the "reactions" button (the button that shows the total number of reactions and opens the modal).
    3.  Locates the scrollable modal container (`scrollable`), the unordered list (`ulElement`), and the individual list items (`liElement`) within the modal.
    4.  Asserts that at least the first reaction `liElement` is visible, ensuring the modal loaded correctly.
    5.  Calls `scrollLazyLoadedListUntilComplete(scrollable, 1000, 300)` to scroll through and load all reactions in the modal.
    6.  After scrolling, it collects all `liElement`s.
    7.  Iterates through each collected reaction `liElement`:
          * Extracts `userName` from a `span` element.
          * Extracts `currentRole` from a `div` element (this often contains job title and company).
          * Extracts `profileLink` from an `<a>` tag's `href` attribute.
          * Extracts `reactionType` from the `alt` attribute of the reaction image.
          * Each extraction includes a `try-catch` block with a short `waitFor` to handle cases where an element might be missing for a specific user, preventing the script from crashing.
    8.  Stores the extracted data in `LinkedInReactionRecord` objects and adds them to the `records` array.
    9.  Calls `writeLinkedInRecordsToCsv(records)` to save the collected data.

#### 7.3. `scrollLazyLoadedListUntilComplete(scrollableContainerLocator: Locator, fixedWaitAfterScrollMs: number = 1000, maxScrollAttempts: number = 300)`

  * **Purpose:** This is the most critical function for handling **dynamically loaded content (infinite scrolling)**. It scrolls a given container repeatedly until no new content appears, indicating the end of the list by monitoring the `scrollHeight`.
  * **Parameters:**
      * `scrollableContainerLocator`: A Playwright `Locator` pointing to the HTML element that needs to be scrolled (e.g., the reactions modal content).
      * `fixedWaitAfterScrollMs`: The amount of time (in milliseconds) to wait *after each scroll* for new content to load and the `scrollHeight` to update and stabilize. Default is `1000` (1 second). This helps account for network delays and rendering time.
      * `maxScrollAttempts`: A safety limit on the number of times the script will attempt to scroll. Prevents infinite loops if the end of the list is never reached or detected. Default is `300`.
  * **Workflow (Scroll Height Stabilization):**
    1.  Initializes `previousScrollHeight` to -1, `currentScrollAttempt` to 0, and `consecutiveSameHeightCount` to 0. A `maxConsecutiveSameHeight` of 3 is used to confirm the end of the list.
    2.  Waits for the `scrollableContainerLocator` to be visible.
    3.  Enters a `while` loop that continues until `maxScrollAttempts` is reached or the end of the list is detected.
    4.  **Inside the loop:**
          * Gets the `scrollHeight` of the container *before* the current scroll attempt.
          * Performs the scroll: `node.scrollTop = node.scrollHeight` scrolls the element to its absolute bottom.
          * Pauses execution using `page().waitForTimeout(fixedWaitAfterScrollMs)` to give the page time to load and render new content and for the `scrollHeight` to reflect any changes.
          * Gets the `scrollHeight` of the container *after* the scroll and the wait period.
          * **Detection Logic:**
              * If `currentScrollHeightAfterWait` is **greater** than `currentScrollHeightBeforeScroll`, it means new content has loaded. The `consecutiveSameHeightCount` is reset, and `previousScrollHeight` is updated.
              * If `currentScrollHeightAfterWait` is **not greater** than `currentScrollHeightBeforeScroll` (meaning no new content loaded in this specific attempt), `consecutiveSameHeightCount` is incremented.
              * If `consecutiveSameHeightCount` reaches `maxConsecutiveSameHeight` (3 consecutive checks with no `scrollHeight` increase), and the `scrollHeight` is non-zero (to avoid false positives on initially empty lists), it's concluded that the end of the list has been reached, and the loop breaks. This "wait-for-stabilization" is a robust way to determine when all content has likely loaded.
    5.  Logs the total attempts and warns if `maxScrollAttempts` was reached.

#### 7.4. `writeLinkedInRecordsToCsv(records: LinkedInReactionRecord[])`

  * **Purpose:** Takes the array of collected reaction records and writes them to a CSV file.
  * **Workflow:**
    1.  Defines the output CSV file name (`linkedin_reactions_data.csv`) and path.
    2.  Configures `csv-writer` with the file path and the header mapping (specifying column names).
    3.  Calls `csvWriter.writeRecords(records)` to write all data.
    4.  Logs a success message or an error if writing fails.

-----

### 8\. How to Run

1.  **Place your `.env` file** in the `project-root` directory.
2.  **Navigate to the `project-root` directory** (the one containing `reactionScript.ts` and `tsconfig.json`) in your terminal.
3.  **Compile the TypeScript script:**
    ```bash
    tsc reactionScript.ts
    ```
    This command compiles `reactionScript.ts` into `reactionScript.js` within the `dist/` folder, as configured by your `tsconfig.json`.
4.  **Run the compiled JavaScript file:**
    ```bash
    node dist/reactionScript.js
    ```

-----

### 9\. Important Considerations and Troubleshooting

  * **Manual Login:** The first time you run the script, or if your session expires, the browser will open, and you will need to manually complete the LinkedIn login process (including any multi-factor authentication, CAPTCHAs, or security checks). The script will pause until it detects you are logged in.
  * **`feedURL` Accuracy:** Ensure your `LINKEDIN_FEED_URL` in the `.env` file is the exact URL of a LinkedIn post (e.g., from your own feed, not a company page or profile). Incorrect URLs will lead to the script failing to find the reactions button.
  * **Selector Changes:** Websites like LinkedIn frequently update their HTML structure. If the script stops working, the first thing to check is if the CSS selectors (e.g., `LOGGED_IN_SELECTOR`, the reactions button, modal locators, or individual data element locators) have changed. You'll need to use your browser's developer tools (Inspect Element) to find the new selectors.
  * **Anti-Bot Measures:** Automated activity may be detected by websites. If you run the script too frequently or collect too many reactions, you might encounter CAPTCHAs, temporary blocks, or unusual behavior. Be mindful of their terms of service and avoid excessive use.
  * **Network Speed:** Slower network connections might require increasing the `fixedWaitAfterScrollMs` value in `scrollLazyLoadedListUntilComplete` to give the page more time to load content after each scroll.
  * **Headless Mode:** The script currently runs in `headless: false` mode, meaning you will see a browser window open. This is essential for the manual login step and for debugging. If you want to run it without a visible browser (after you're confident it's working and your session is saved), you can change `headless: false` to `headless: true` in `main()`.
  * **Error Handling:** The script includes `try-catch` blocks for individual data extraction points, allowing it to continue even if some pieces of information (like a user's role) are missing for a specific user. Errors during core operations like login or initial modal opening will stop the script.