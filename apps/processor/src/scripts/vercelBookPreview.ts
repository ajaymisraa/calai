/**
 * Google Books Preview Extractor for Vercel Deployment
 * 
 * This script extracts 3 pages from a Google Books preview, splits each
 * into left and right halves, and returns an array of URLs to the images.
 * It's designed to be used in a Vercel serverless function.
 */

import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import * as os from 'os';
import * as crypto from 'crypto';
import { chromium } from 'playwright-core';
import { getChromiumOptions, cleanupChrome, createBrowserContext } from '../utils/vercelPlaywright';

// Define types
interface ExtractPreviewOptions {
  bookId: string;
  webReaderLink: string;
  maxPages?: number;
}

interface PreviewResult {
  bookId: string;
  images: {
    left: string[];
    right: string[];
  };
}

/**
 * Splits an image buffer into left and right halves
 * @param inputBuffer The input image buffer
 * @returns Promise resolving to an array of two buffers [leftHalf, rightHalf]
 */
export async function splitImageIntoHalves(inputBuffer: Buffer): Promise<[Buffer, Buffer]> {
  // Get the image metadata to determine dimensions
  const metadata = await sharp(inputBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  
  if (width === 0 || height === 0) {
    throw new Error('Could not determine image dimensions');
  }
  
  console.log(`Splitting image (${width}x${height}) into left and right halves`);
  
  // Calculate half width - exactly 50% of the image
  const halfWidth = Math.floor(width / 2);
  
  // Create a separate Sharp instance for each half to avoid any shared state issues
  
  // Extract left half (from x=0 to x=halfWidth)
  const leftHalf = await sharp(inputBuffer)
    .extract({
      left: 0,
      top: 0,
      width: halfWidth,
      height: height
    })
    .toBuffer();
  
  // Extract right half (from x=halfWidth to x=width)
  const rightHalf = await sharp(inputBuffer)
    .extract({
      left: halfWidth,
      top: 0,
      width: width - halfWidth, // Account for odd widths
      height: height
    })
    .toBuffer();
  
  // Verify the halves were created successfully
  const leftMetadata = await sharp(leftHalf).metadata();
  const rightMetadata = await sharp(rightHalf).metadata();
  
  console.log(`Left half dimensions: ${leftMetadata.width}x${leftMetadata.height}`);
  console.log(`Right half dimensions: ${rightMetadata.width}x${rightMetadata.height}`);
  
  if (!leftMetadata.width || !rightMetadata.width) {
    throw new Error('Failed to create image halves');
  }
  
  return [leftHalf, rightHalf];
}

/**
 * Extract preview pages from Google Books and split them into halves
 * @param options Options for extraction including bookId and webReaderLink
 * @returns Promise resolving to an object with arrays of left and right image URLs
 */
export async function extractBookPreview(options: ExtractPreviewOptions): Promise<PreviewResult> {
  const { bookId, webReaderLink, maxPages = 3 } = options;
  
  // Helper function for waiting
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Create book-specific cache directory
  const cacheBaseDir = path.join(os.tmpdir(), 'book-previews');
  if (!fs.existsSync(cacheBaseDir)) {
    fs.mkdirSync(cacheBaseDir, { recursive: true });
  }
  
  // Create book-specific directory within the cache
  const bookCacheDir = path.join(cacheBaseDir, bookId);
  if (!fs.existsSync(bookCacheDir)) {
    fs.mkdirSync(bookCacheDir, { recursive: true });
  } else {
    // Clean existing files for this book
    try {
      const existingFiles = fs.readdirSync(bookCacheDir);
      for (const file of existingFiles) {
        if (file.endsWith('.jpg') || file.endsWith('.png')) {
          fs.unlinkSync(path.join(bookCacheDir, file));
        }
      }
    } catch (e) {
      console.error('Error cleaning book cache directory:', e);
    }
  }
  
  // Prepare result object
  const result: PreviewResult = {
    bookId,
    images: {
      left: [],
      right: []
    }
  };
  
  try {
    // Format the base URL
    const urlBookId = webReaderLink.includes('id=') 
      ? webReaderLink.split('id=')[1].split('&')[0] 
      : bookId;
    
    const baseUrl = `https://play.google.com/books/reader?id=${urlBookId}&hl=&as_pt=BOOKS&source=gbs_api`;
    
    // Get optimized launch options for Vercel serverless environment
    const options = await getChromiumOptions();
    
    // Launch browser with serverless-optimized settings
    const browser = await chromium.launch(options);
    
    // Create context with our helper (handles user data directory)
    const context = await createBrowserContext(browser);
    
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    
    // Navigate to first page to detect the exact pattern
    console.log("Navigating to initial page to detect pattern...");
    const initialPageUrl = `${baseUrl}&pg=PA1`;
    console.log(`Navigating to initial page: ${initialPageUrl}`);

    // Navigate and wait for page to fully load
    await page.goto(initialPageUrl, { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    // Give it a moment to settle
    await wait(2000);

    // Get the final URL after redirect to determine pattern
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
        return result;
      }
    }

    // Process the first page
    const screenshot1 = await page.screenshot({ 
      fullPage: true,
      type: 'png'
    });

    // Split into halves and save first page
    const [leftHalf1, rightHalf1] = await splitImageIntoHalves(screenshot1);

    // Process left half
    const leftJpeg1 = await sharp(leftHalf1)
      .jpeg({ quality: 95 })
      .toBuffer();
    const leftPath1 = path.join(bookCacheDir, `page-1-left.jpg`);
    fs.writeFileSync(leftPath1, leftJpeg1);
    console.log(`Saved left half of page 1, size: ${(leftJpeg1.length / 1024).toFixed(2)}KB`);

    // Process right half
    const rightJpeg1 = await sharp(rightHalf1)
      .jpeg({ quality: 95 })
      .toBuffer();
    const rightPath1 = path.join(bookCacheDir, `page-1-right.jpg`);
    fs.writeFileSync(rightPath1, rightJpeg1);
    console.log(`Saved right half of page 1, size: ${(rightJpeg1.length / 1024).toFixed(2)}KB`);

    // Add to result
    result.images.left.push(leftPath1);
    result.images.right.push(rightPath1);

    // Navigate to next pages by incrementing the page number by 2
    // We'll capture a total of 4 pages (including the first one)
    const pagesToCapture = 4;

    // Start from page 2 since we already processed page 1
    for (let displayPageNum = 2; displayPageNum <= Math.min(pagesToCapture, maxPages); displayPageNum++) {
      try {
        // Increment by 2
        pageNumber += 2;
        
        const pagePattern = `${pageFormat}${pageNumber}${pageSuffix}`;
        const pageUrl = `${baseUrl}&pg=${pagePattern}`;
        console.log(`Navigating to pattern ${pagePattern}: ${pageUrl}`);
        
        // Navigate with optimized settings
        await page.goto(pageUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 20000 
        });
        
        // Reduced wait time for rendering
        await wait(2000);
        
        // Take screenshot
        const screenshot = await page.screenshot({ 
          fullPage: true,
          type: 'png'
        });
        
        // Split into halves
        const [leftHalf, rightHalf] = await splitImageIntoHalves(screenshot);
        
        // Process left half
        const leftJpeg = await sharp(leftHalf)
          .jpeg({ quality: 95 })
          .toBuffer();
        const leftPath = path.join(bookCacheDir, `page-${displayPageNum}-left.jpg`);
        fs.writeFileSync(leftPath, leftJpeg);
        console.log(`Saved left half of page ${displayPageNum}, size: ${(leftJpeg.length / 1024).toFixed(2)}KB`);
        
        // Process right half
        const rightJpeg = await sharp(rightHalf)
          .jpeg({ quality: 95 })
          .toBuffer();
        const rightPath = path.join(bookCacheDir, `page-${displayPageNum}-right.jpg`);
        fs.writeFileSync(rightPath, rightJpeg);
        console.log(`Saved right half of page ${displayPageNum}, size: ${(rightJpeg.length / 1024).toFixed(2)}KB`);
        
        // Add to result
        result.images.left.push(leftPath);
        result.images.right.push(rightPath);
        
        // Wait before next page
        if (displayPageNum < Math.min(pagesToCapture, maxPages)) {
          await wait(1000);
        }
      } catch (error) {
        console.error(`Error processing page pattern ${pageFormat}${pageNumber}${pageSuffix}:`, error);
        // Continue to next page
      }
    }
    
    await browser.close();
    await cleanupChrome(); // Free up resources
    
    return result;
  } catch (error) {
    console.error('Error extracting book preview:', error);
    // Clean up temp directory on error
    try {
      if (fs.existsSync(bookCacheDir)) {
        fs.rmSync(bookCacheDir, { recursive: true });
      }
    } catch (cleanupError) {
      console.error('Error cleaning up book cache directory:', cleanupError);
    }
    
    throw error;
  }
}

// Example usage in a Vercel serverless function:
/*
import { extractBookPreview } from './vercelBookPreview';

export default async function handler(req, res) {
  const { bookId, webReaderLink } = req.body;
  
  try {
    const result = await extractBookPreview({
      bookId,
      webReaderLink
    });
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
*/

// For testing outside of Vercel
if (require.main === module) {
  // This will run when the script is executed directly
  const [bookId, webReaderLink] = process.argv.slice(2);
  
  if (!bookId || !webReaderLink) {
    console.log('Usage: ts-node vercelBookPreview.ts <bookId> <webReaderLink>');
    process.exit(1);
  }
  
  extractBookPreview({ bookId, webReaderLink })
    .then(result => {
      console.log('Successfully extracted and split book preview:');
      console.log(`Left images: ${result.images.left.length}`);
      console.log(`Right images: ${result.images.right.length}`);
      
      // List the files
      console.log('\nLeft image paths:');
      result.images.left.forEach(path => console.log(`- ${path}`));
      
      console.log('\nRight image paths:');
      result.images.right.forEach(path => console.log(`- ${path}`));
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
} 