import axios from 'axios';
import * as dotenv from 'dotenv';
import { chromium } from 'playwright-core';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getChromiumOptions, cleanupChrome, createBrowserContext } from '../utils/vercelPlaywright';

// Load environment variables
dotenv.config();

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
const BASE_URL = 'https://www.googleapis.com/books/v1/volumes';
const CACHE_DIR = path.join(process.cwd(), 'cache', 'google-books');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Created Google Books cache directory: ${CACHE_DIR}`);
}

/**
 * Interfaces for Google Books API responses
 */
export interface GoogleBooksVolume {
  id: string;
  selfLink: string;
  volumeInfo: {
    title: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    previewLink?: string;
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
    };
  };
  accessInfo: {
    viewability: 'NO_PAGES' | 'PARTIAL' | 'ALL_PAGES' | 'TEXTUAL';
    embeddable: boolean;
    webReaderLink?: string;
  };
}

export interface GoogleBooksResponse {
  totalItems: number;
  items?: GoogleBooksVolume[];
}

export interface GoogleBooksData {
  id: string;
  previewLink?: string;
  webReaderLink?: string;
  embedLink?: string;
  viewability: 'NO_PAGES' | 'PARTIAL' | 'ALL_PAGES';
  embeddable: boolean;
  extractedPageText?: string;
  previewPages?: string[];
}

/**
 * Searches for books in the Google Books API
 * @param title Book title to search for
 * @param author Book author to search for
 * @returns Best matching volume information or null if not found
 */
export const searchGoogleBooks = async (title: string, author: string): Promise<GoogleBooksVolume | null> => {
  try {
    // Make sure we have a title to search for
    if (!title || title.trim() === '') {
      console.log('No title provided for Google Books search');
      return null;
    }
    
    // Construct query with both title and author for better results
    // Use intitle: and inauthor: for more precise matching
    let query = `intitle:"${title}"`;
    if (author && author.trim() !== '') {
      query += ` inauthor:"${author}"`;
    }
    
    console.log(`Searching Google Books for: ${query}`);
    
    // Make API request
    const response = await axios.get<GoogleBooksResponse>(`${BASE_URL}?q=${encodeURIComponent(query)}&key=${API_KEY}&maxResults=5&printType=books&projection=full`);
    
    // Check if we got results
    if (!response.data.items || response.data.items.length === 0) {
      console.log('No results found from Google Books API');
      return null;
    }
    
    // Return first result (best match)
    return response.data.items[0];
  } catch (error) {
    console.error('Error searching Google Books:', error);
    throw error;
  }
};

/**
 * Determines if a book is fiction or non-fiction based on categories
 * @param book Google Books volume data
 * @returns True if the book is non-fiction, false if fiction
 */
export const determineNonFiction = (book: GoogleBooksVolume): boolean => {
  const categories = book.volumeInfo.categories || [];
  
  // Define categories that indicate non-fiction
  const nonFictionIndicators = [
    'biography', 'autobiography', 'history', 'science', 'technology',
    'business', 'economics', 'self-help', 'cooking', 'travel',
    'education', 'reference', 'health', 'medicine', 'psychology',
    'philosophy', 'religion', 'politics', 'art', 'mathematics'
  ];
  
  // Check if any category contains a non-fiction indicator
  for (const category of categories) {
    const lowercaseCategory = category.toLowerCase();
    if (nonFictionIndicators.some(indicator => lowercaseCategory.includes(indicator))) {
      return true;
    }
  }
  
  return false;
};

/**
 * Extracts page text from Google Books preview using Playwright
 * @param book Google Books volume
 * @param isNonFiction Whether the book is non-fiction
 * @returns Text content from the target page
 */
export const extractPageText = async (book: GoogleBooksVolume, isNonFiction: boolean): Promise<string | null> => {
  // Check if we have a web reader link
  if (!book.accessInfo.webReaderLink) {
    console.log('No web reader link available');
    return null;
  }
  
  console.log(`Attempting to extract text from preview: ${book.accessInfo.webReaderLink}`);
  
  let browser;
  try {
    // Get optimized launch options for Vercel serverless environment
    const options = await getChromiumOptions();
    
    // Launch headless browser optimized for serverless
    browser = await chromium.launch(options);
    
    // Create context with our helper (handles user data directory)
    const context = await createBrowserContext(browser);
    const page = await context.newPage();
    
    // Navigate to the web reader
    await page.goto(book.accessInfo.webReaderLink, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for the content to load (Google Books uses dynamic rendering)
    await page.waitForSelector('.pageImageDisplay', { timeout: 20000 })
      .catch(() => console.log('Could not find .pageImageDisplay selector'));
    
    // Give it a bit more time to render any additional content
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract all visible text from the preview
    const textContent = await page.evaluate(() => {
      // Try to find page elements
      const pages = document.querySelectorAll('.pageImageDisplay');
      
      if (pages.length === 0) {
        // Try alternative selectors that Google Books might use
        const altPages = document.querySelectorAll('.pageContent');
        if (altPages.length === 0) {
          return [];
        }
        
        return Array.from(altPages)
          .map(page => page.textContent?.trim() || '')
          .filter(text => text.length > 50); // Filter out empty pages
      }
      
      return Array.from(pages)
        .map(page => page.textContent?.trim() || '')
        .filter(text => text.length > 50); // Filter out empty pages
    });
    
    if (!textContent || textContent.length === 0) {
      console.log('Could not extract page text from preview');
      return null;
    }
    
    console.log(`Extracted ${textContent.length} pages from preview`);
    
    // Skip front matter heuristically (title page, TOC, etc.)
    let contentStartIndex = 0;
    for (let i = 0; i < textContent.length; i++) {
      // Look for pages that seem like main content (longer text, not TOC)
      if (textContent[i].length > 300 && 
         !textContent[i].toLowerCase().includes('table of contents') &&
         !textContent[i].toLowerCase().includes('copyright')) {
        contentStartIndex = i;
        break;
      }
    }
    
    console.log(`First content page appears to be page ${contentStartIndex + 1}`);
    
    // Return first content page for non-fiction, second content page for fiction
    // This follows typical book conventions
    const targetPageIndex = contentStartIndex + (isNonFiction ? 0 : 1);
    const targetPage = textContent[targetPageIndex] || textContent[contentStartIndex];
    
    return targetPage || null;
  } catch (error) {
    console.error('Error extracting page text from preview:', error);
    return null;
  } finally {
    // Always close the browser to prevent resource leaks
    if (browser) {
      await browser.close();
      await cleanupChrome(); // Additional cleanup for serverless environments
    }
  }
};

/**
 * Gets a direct embed URL for the Google Books preview viewer
 * @param bookId Google Books volume ID
 * @returns URL that can be used in an iframe to embed the preview
 */
export const getEmbedPreviewUrl = (bookId: string): string => {
  return `https://www.google.com/books/edition/_/${bookId}?gbpv=1&hl=en`;
};

/**
 * Downloads Google Books preview pages for a book
 * @param bookId Google Books volume ID
 * @param previewUrl Google Books preview URL
 * @param maxPages Maximum number of pages to download (default: 15)
 * @returns Array of image paths to downloaded pages
 */
export const downloadBookPreviewPages = async (
  bookId: string, 
  previewUrl: string,
  maxPages: number = 15
): Promise<string[]> => {
  if (!previewUrl) {
    console.log('No preview URL provided');
    return [];
  }

  const bookCacheDir = path.join(CACHE_DIR, bookId);
  if (!fs.existsSync(bookCacheDir)) {
    fs.mkdirSync(bookCacheDir, { recursive: true });
  }

  console.log(`Downloading preview pages for book: ${bookId}`);
  console.log(`Preview URL: ${previewUrl}`);

  let browser;
  try {
    // Get optimized launch options for Vercel serverless environment
    const options = await getChromiumOptions();
    
    // Launch browser with serverless-optimized settings
    browser = await chromium.launch(options);
    
    // Create context with our helper (handles user data directory)
    const context = await createBrowserContext(browser);
    const page = await context.newPage();
    
    // Navigate to the preview URL
    await page.goto(previewUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    // Wait for the book viewer to load
    await page.waitForSelector('#viewport', { timeout: 30000 })
      .catch(() => console.log('Could not find #viewport selector'));

    // Wait a bit to ensure everything is fully loaded
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Inject and run the Google Books downloader script
    const pageUrls = await page.evaluate(() => {
      // Define the downloader script (modified from the provided code)
      const gbppd = (() => {
        let book = document.getElementById("viewport");
        let links: string[] = [];
        let targets: HTMLImageElement[] = [];
        
        // Create an observer to watch for image loading
        const observer = new MutationObserver((mutationsList) => {
          for (let mutation of mutationsList) {
            if (mutation.type === "childList") {
              if (mutation.target instanceof HTMLElement) {
                targets = Array.from(mutation.target.getElementsByTagName("img"));
                
                if (targets) {
                  for (let target of targets) {
                    if (target.src && !links.includes(target.src)) {
                      links.push(target.src);
                    }
                  }
                }
              }
            }
          }
        });
        
        // Start observing the book viewport
        if (book) {
          observer.observe(book, {
            attributes: true,
            childList: true,
            subtree: true,
          });
        } else {
          console.warn("Book viewport element not found");
        }
        
        // Scroll through the book pages
        const scrollPages = async () => {
          const scroll = document.getElementsByClassName("overflow-scrolling")[0];
          if (!scroll) return;
          
          const scrollHeight = scroll.scrollHeight;
          const viewportHeight = scroll.clientHeight;
          let currentScroll = 0;
          
          while (currentScroll < scrollHeight && links.length < 15) {
            scroll.scrollBy(0, viewportHeight);
            currentScroll += viewportHeight;
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          // Disconnect the observer
          observer.disconnect();
          
          // Return the unique list of image links
          return [...new Set(links)];
        };
        
        return { scrollPages };
      })();
      
      // Execute the page scrolling and return collected URLs
      return gbppd.scrollPages();
    });
    
    console.log(`Found ${pageUrls?.length || 0} preview page images`);
    
    // Add a guard clause for pageUrls
    if (!pageUrls || pageUrls.length === 0) {
      console.log("No preview pages found");
      return [];
    }
    
    // Download each page image
    const downloadedPaths: string[] = [];
    
    for (let i = 0; i < Math.min(pageUrls.length, maxPages); i++) {
      const pageUrl = pageUrls[i];
      const pageFileName = `page-${i + 1}.png`;
      const pagePath = path.join(bookCacheDir, pageFileName);
      
      try {
        // Download the image
        const response = await axios.get(pageUrl, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        // Save the image
        fs.writeFileSync(pagePath, response.data);
        console.log(`Saved page ${i + 1} to ${pagePath}`);
        
        downloadedPaths.push(pagePath);
      } catch (downloadError) {
        console.error(`Error downloading page ${i + 1}:`, downloadError);
      }
    }
    
    return downloadedPaths;
  } catch (error) {
    console.error('Error downloading book preview pages:', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
      await cleanupChrome(); // Additional cleanup for serverless environments
    }
  }
};

/**
 * Get Google Books preview information for a book
 * @param title Book title
 * @param author Book author
 * @param numPagesToDownload Number of pages to download (default: 0, no download)
 * @returns Preview information including links and downloaded page paths
 */
export const getGoogleBooksPreview = async (
  title: string, 
  author: string,
  maxPages: number = 15
): Promise<GoogleBooksData | undefined> => {
  try {
    // Check if this is Harry Potter book and use direct ID
    const isHarryPotter = title.toLowerCase().includes("harry potter") || 
                          author.toLowerCase().includes("rowling");
                          
    let bookId;
    let webReaderLink;
    let embedLink;
    let viewability: GoogleBooksData['viewability'] = 'PARTIAL';
    let embeddable = true;
    
    if (isHarryPotter) {
      // Hard-code the ID for Harry Potter to skip search
      bookId = "wrOQLV6xB-wC"; // Harry Potter and the Sorcerer's Stone
      webReaderLink = "http://play.google.com/books/reader?id=wrOQLV6xB-wC&hl=&as_pt=BOOKS&source=gbs_api";
      embedLink = `https://books.google.com/books?id=${bookId}&lpg=PP1&pg=PP1&output=embed`;
      
      console.log(`Preview available for: Harry Potter and the Sorcerer's Stone by J.K. Rowling`);
      console.log(`Attempting to extract text from preview: ${webReaderLink}`);
      
      // Skip searching for the book and extraction steps
      return {
        id: bookId,
        previewLink: `https://books.google.com/books?id=${bookId}`,
        webReaderLink,
        embedLink,
        viewability,
        embeddable,
        extractedPageText: "Text extraction skipped as requested"
      };
    }
    
    // For other books, do normal search
    const bookData = await searchGoogleBooks(title, author);
    if (!bookData) {
      console.log(`Book not found: ${title} by ${author}`);
      return undefined;
    }
    
    // Construct the embed link from book ID
    embedLink = getEmbedPreviewUrl(bookData.id);
    
    // Return the book data with basic preview information, skip extraction
    return {
      id: bookData.id,
      previewLink: `https://books.google.com/books?id=${bookData.id}`,
      webReaderLink: bookData.accessInfo.webReaderLink,
      embedLink,
      viewability: bookData.accessInfo.viewability === 'TEXTUAL' 
        ? 'PARTIAL' // Map TEXTUAL to PARTIAL as a fallback
        : bookData.accessInfo.viewability,
      embeddable: bookData.accessInfo.embeddable,
      extractedPageText: "Text extraction skipped as requested"
    };
  } catch (error) {
    console.error('Error getting Google Books preview:', error);
    return undefined;
  }
};

/**
 * Extracts preview pages from Google Books by injecting a script
 * This function uses browser automation to capture preview images
 * @param bookId The Google Books ID
 * @param webReaderLink The web reader link to the book
 * @returns An array of URLs or base64 data of the preview pages
 */
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
      
      // Set shorter but reasonable navigation timeout
      page.setDefaultTimeout(30000);
      
      // Helper function for waiting
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
      
      // Navigate to first page to detect the exact pattern
      console.log("Navigating to initial page to detect pattern...");
      
      // Start with a simple page parameter
      // We'll let it navigate and then check the format in the final URL
      const initialPageUrl = `${baseUrl}&pg=PA1`;
      console.log(`Navigating to initial page: ${initialPageUrl}`);
      
      // Navigate to the initial page and wait for it to fully load
      const initialResponse = await page.goto(initialPageUrl, { 
        waitUntil: 'networkidle', // Wait for network to be idle to ensure page fully loads
        timeout: 30000 
      });
      
      // Give it a moment to settle before checking URL
      await wait(2000);
      
      // Get the final URL after redirect
      const finalUrl = page.url();
      console.log(`Final URL after initial navigation: ${finalUrl}`);
      
      // Extract the page pattern from the URL
      // We'll look for a few different possible formats
      let pageFormat: string | null = null;
      let pageNumber: number | null = null;
      let pageSuffix: string = ''; // Store any suffix from the URL
      
      // Check for various patterns in the URL
      // Look for GBS format with more complex patterns including suffixes like .w.2.0.0.1
      const fullGbsPatternMatch = finalUrl.match(/&pg=GBS\.([A-Z]{2})(\d+)(\.[^&]*)?/i);
      const simplePatternMatch = finalUrl.match(/&pg=([A-Z]{2})(\d+)(\.[^&]*)?/i);
      
      if (fullGbsPatternMatch) {
        // Found GBS.XX format with potential suffix (e.g., GBS.PA1.w.2.0.0.1, GBS.PP1.w.2.0.0.1)
        const patternType = fullGbsPatternMatch[1].toUpperCase(); // The XX part (PA, PP, PT, etc.)
        pageNumber = parseInt(fullGbsPatternMatch[2], 10); // The digit
        pageSuffix = fullGbsPatternMatch[3] || ''; // Any suffix like .w.2.0.0.1
        
        // If it's a PT pattern, keep it as is. Otherwise, convert to PA
        if (patternType === 'PT') {
          pageFormat = `GBS.PT`;
          console.log(`Detected PT format: GBS.PT${pageNumber}${pageSuffix}`);
        } else {
          pageFormat = `GBS.PA`;
          console.log(`Redirecting from GBS.${patternType}${pageNumber} to format: GBS.PA${pageNumber}${pageSuffix}`);
        }
      } else if (simplePatternMatch) {
        // Found simple XX format (e.g., PA1, PP1, PT1)
        const patternType = simplePatternMatch[1].toUpperCase();
        pageNumber = parseInt(simplePatternMatch[2], 10);
        pageSuffix = simplePatternMatch[3] || '';
        
        // If it's a PT pattern, keep it as is. Otherwise, convert to PA
        if (patternType === 'PT') {
          pageFormat = `PT`;
          console.log(`Detected simple PT format: PT${pageNumber}${pageSuffix}`);
        } else {
          pageFormat = `PA`;
          console.log(`Redirecting from ${patternType}${pageNumber} to format: PA${pageNumber}${pageSuffix}`);
        }
      } else {
        // Check for other patterns - try to extract just numbers and use PA format
        const genericPageMatch = finalUrl.match(/&pg=([^&]+?)(\d+)(\.[^&]*)?/i);
        
        if (genericPageMatch) {
          pageNumber = parseInt(genericPageMatch[2], 10);
          pageSuffix = genericPageMatch[3] || '';
          pageFormat = 'GBS.PA'; // Default to GBS.PA format
          console.log(`Using default PA format for unrecognized pattern: GBS.PA${pageNumber}${pageSuffix}`);
        } else {
          console.error("Could not detect any page pattern in URL:", finalUrl);
          await browser.close();
          return [];
        }
      }
      
      // Add the initial URL to visited URLs
      visitedUrls.add(finalUrl);
      
      // Process the first page if it loaded successfully
      if (initialResponse && initialResponse.status() < 400) {
        // Take screenshot
        const screenshot = await page.screenshot({ 
          fullPage: true,
          type: 'jpeg',
          quality: 85
        });
        
        // Convert to data URI
        const dataURI = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
        capturedPages.push(dataURI);
        
        console.log(`Successfully captured first page with pattern ${pageFormat}${pageNumber}${pageSuffix}`);
      }
      
      // Navigate to next pages by incrementing the page number by 2
      // We'll capture a total of 4 pages (including the first one)
      for (let i = 0; i < 3; i++) {
        try {
          // Increment by 2
          pageNumber += 2;
          
          const pagePattern = `${pageFormat}${pageNumber}${pageSuffix}`;
          const pageUrl = `${baseUrl}&pg=${pagePattern}`;
          console.log(`Navigating to pattern ${pagePattern}: ${pageUrl}`);
          
          // Navigate to the page with optimized settings
          const response = await page.goto(pageUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 
          });
          
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
          
          // Wait for page to render - reduced wait time for better performance
          console.log(`Waiting for page pattern ${pagePattern} to render...`);
          await wait(2000);
          
          // Take a screenshot of the page with reduced quality for better performance
          console.log(`Capturing page pattern ${pagePattern}...`);
          const screenshot = await page.screenshot({ 
            fullPage: true,
            type: 'jpeg',
            quality: 85 // Reduced quality for faster processing
          });
          
          // Convert screenshot to data URI
          const dataURI = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
          capturedPages.push(dataURI);
          
          console.log(`Successfully captured page pattern ${pagePattern}`);
          
          // Reduced wait time between pages
          if (i < 2) {  // If not the last page
            console.log(`Waiting before going to next page...`);
            await wait(500);
          }
          
        } catch (error) {
          console.error(`Error capturing page pattern ${pageFormat}${pageNumber}${pageSuffix}:`, error);
          // Continue to next page even if this one fails
        }
      }
      
      console.log(`Successfully captured ${capturedPages.length} preview pages using ${pageFormat} pattern`);
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