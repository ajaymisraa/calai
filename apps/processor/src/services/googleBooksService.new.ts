/**
 * Extracts preview pages from Google Books by injecting a script
 * This function uses browser automation to capture preview images from specific pages
 * @param bookId The Google Books ID
 * @param webReaderLink The web reader link to the book
 * @returns An array of URLs or base64 data of the preview pages
 */
import { chromium } from 'playwright-core';
import { getChromiumOptions, cleanupChrome, createBrowserContext } from '../utils/vercelPlaywright';

export async function extractPreviewPagesFromGoogleBooks(bookId: string, webReaderLink: string): Promise<string[]> {
  try {
    console.log(`Extracting preview pages for book: ${bookId}`);
    console.log(`Using web reader link: ${webReaderLink}`);
    
    // Get optimized launch options for Vercel serverless environment
    const options = await getChromiumOptions();
    
    // Launch browser with serverless-optimized settings
    const browser = await chromium.launch(options);
    
    try {
      // Create context with our helper (handles user data directory)
      const context = await createBrowserContext(browser);
      const page = await context.newPage();
      
      // Set a more reasonable navigation timeout
      page.setDefaultTimeout(60000);
      
      // Helper function for waiting - replacement for waitForTimeout
      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      // Format the base URL correctly
      // Extract the book ID from the webReaderLink if present, otherwise use the provided bookId
      const urlBookId = webReaderLink.includes('id=') 
        ? webReaderLink.split('id=')[1].split('&')[0] 
        : bookId;
      
      const baseUrl = `https://play.google.com/books/reader?id=${urlBookId}&hl=&as_pt=BOOKS&source=gbs_api`;
      console.log(`Using base URL: ${baseUrl}`);
      
      // Array to store captured pages
      const capturedPages: string[] = [];
      
      // Track visited URLs to prevent duplicates caused by redirects
      const visitedUrls = new Set<string>();
      
      // Define specific page patterns as requested: GBS.PA1, GBS.PA3, GBS.PA5, and GBS.PA7
      const pagePatterns = ['GBS.PA1', 'GBS.PA3', 'GBS.PA5', 'GBS.PA7'];
      console.log('Using specific page patterns: GBS.PA1, GBS.PA3, GBS.PA5, GBS.PA7');
      console.log(`Extracting ${pagePatterns.length} pages...`);
      
      // Navigate to each page sequentially and capture content
      for (let i = 0; i < pagePatterns.length; i++) {
        try {
          const pagePattern = pagePatterns[i];
          const pageUrl = `${baseUrl}&pg=${pagePattern}`;
          console.log(`Navigating to pattern ${pagePattern}: ${pageUrl}`);
          
          // Navigate to the page
          const response = await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
          
          // Get the final URL after any redirects
          const finalUrl = page.url();
          console.log(`Final URL after navigation: ${finalUrl}`);
          
          // Check if we've already visited this URL (indicating a redirect to a page we've seen)
          if (visitedUrls.has(finalUrl)) {
            console.log(`Skipping duplicate page at ${finalUrl} - already visited`);
            continue;
          }
          
          // Add the final URL to our visited set
          visitedUrls.add(finalUrl);
          
          // Check if the response status indicates a redirect to an error page
          if (response && (response.status() === 404 || response.status() >= 400)) {
            console.log(`Skipping page pattern ${pagePattern} - received status code ${response.status()}`);
            continue;
          }
          
          // Wait for the page to fully render
          console.log(`Waiting for page pattern ${pagePattern} to fully render...`);
          await wait(5000);
          
          // Take a screenshot of the page
          console.log(`Capturing page pattern ${pagePattern}...`);
          const screenshot = await page.screenshot({ 
            fullPage: true,
            type: 'jpeg',
            quality: 100 // Maximum quality for best readability
          });
          
          // Convert screenshot to data URI
          const dataURI = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
          capturedPages.push(dataURI);
          
          console.log(`Successfully captured page pattern ${pagePattern}`);
          
          // Wait between page captures to avoid rate limiting
          if (i < pagePatterns.length - 1) {
            console.log(`Waiting before going to next page...`);
            await wait(1000); 
          }
          
        } catch (error) {
          console.error(`Error capturing page pattern ${pagePatterns[i]}:`, error);
          // Continue to next page even if this one fails
        }
      }
      
      console.log(`Successfully captured ${capturedPages.length} preview pages`);
      await browser.close();
      await cleanupChrome();
      
      return capturedPages;
    } catch (error) {
      await browser.close();
      await cleanupChrome();
      throw error;
    }
  } catch (error) {
    console.error('Error extracting preview pages:', error);
    return [];
  }
}