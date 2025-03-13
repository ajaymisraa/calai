/**
 * Book Image Cache Service
 * 
 * This service handles the caching, generation, and processing of book-related images.
 * Key functionality includes:
 * 
 * 1. Image Splitting: Each generated image is split into left and right halves,
 *    with the original image deleted after processing.
 * 
 * 2. Descriptive Filenames: Images are saved with descriptive filenames that include:
 *    - Book ID
 *    - Page number or identifier (including PT number for duplicates)
 *    - Left or right slice indicator
 *    Example: "book123_PT2_left.png" or "book456_page7_right.png"
 * 
 * 3. Duplicate Detection: The system detects duplicate content based on a content hash
 *    and assigns PT (Page Type) numbers to differentiate them:
 *    - First occurrence: normal page number
 *    - First duplicate: PT1
 *    - Second duplicate: PT2
 *    - And so on...
 * 
 * 4. OCR Processing: Images can be processed with OCR and the results cached.
 * 
 * 5. Folder Organization: Each book gets its own folder within the cache directory.
 *    For example: cache/book-images/book123/page1_left.png
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { createCanvas, loadImage, Image } from 'canvas';
import * as crypto from 'crypto';
import Tesseract from 'tesseract.js';
import { setTimeout } from 'timers/promises';
import sharp from 'sharp';
import { performOCR as utilsPerformOCR, processBookDirectoryWithOCR } from '../utils/ocrUtils';

// Cache directory configuration
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');
const OCR_CACHE_DIR = path.join(process.cwd(), 'cache', 'book-ocr'); // Kept for reference but not used
const MAX_CACHE_AGE_DAYS = 30; // How long to keep cached images

// Ensure cache directories exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Created book image cache directory: ${CACHE_DIR}`);
}

// OCR_CACHE_DIR is no longer created or used
// This directory has been deprecated in favor of storing OCR results directly with the book images

// Track processed image sizes to detect duplicates 
const processedImageSizes: Map<string, number> = new Map();

// Export for testing purposes
export { processedImageSizes };

// Interface for OCR results
export interface OCRResult {
  text: string;
  confidence: number;
  imagePath: string;
  pageNumber: number | string;
}

/**
 * Gets or creates the book-specific cache directory
 * @param bookId Google Books volume ID
 * @returns Path to the book's cache directory
 */
function getBookCacheDir(bookId: string): string {
  // Sanitize the bookId to make it safe for filesystem
  const safeBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
  const bookDir = path.join(CACHE_DIR, safeBookId);
  
  // Create the directory if it doesn't exist
  if (!fs.existsSync(bookDir)) {
    fs.mkdirSync(bookDir, { recursive: true });
    console.log(`Created cache directory for book ${bookId}: ${bookDir}`);
  }
  
  return bookDir;
}

/**
 * Generates a unique filename for caching based on book ID and page number
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns Hashed filename suitable for filesystem storage
 */
function generateCacheFilename(bookId: string, pageNum: number | string): string {
  const hash = crypto.createHash('md5').update(`${bookId}-${pageNum}`).digest('hex');
  return `${hash}.png`;
}

/**
 * Generates a unique filename for OCR cache
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns Hashed filename for OCR results
 */
function generateOCRCacheFilename(bookId: string, pageNum: number | string): string {
  const hash = crypto.createHash('md5').update(`ocr-${bookId}-${pageNum}`).digest('hex');
  return `${hash}.json`;
}

/**
 * Checks if a page image exists in the cache
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns True if the image is in the cache, false otherwise
 */
export function isImageCached(bookId: string, pageNum: number | string): boolean {
  const bookDir = getBookCacheDir(bookId);
  const filename = generateCacheFilename(bookId, pageNum);
  const filepath = path.join(bookDir, filename);
  return fs.existsSync(filepath);
}

/**
 * Checks if OCR results for a page exist in cache
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns True if OCR results are cached, false otherwise
 */
export function isOCRCached(bookId: string, pageNum: number | string): boolean {
  // Always return false since we're not using the book-ocr folder
  return false;
}

/**
 * Retrieves a cached image path
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns Path to the cached image or null if not found
 */
export function getCachedImagePath(bookId: string, pageNum: number | string): string | null {
  const bookDir = getBookCacheDir(bookId);
  const filename = generateCacheFilename(bookId, pageNum);
  const filepath = path.join(bookDir, filename);
  
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    const maxAgeDate = new Date();
    maxAgeDate.setDate(maxAgeDate.getDate() - MAX_CACHE_AGE_DAYS);
    
    // Check if the cached file is older than the max age
    if (stats.mtime > maxAgeDate) {
      return filepath;
    } else {
      // Remove expired cache file
      try {
        fs.unlinkSync(filepath);
        console.log(`Removed expired cache file: ${filepath}`);
      } catch (error) {
        console.error(`Error removing expired cache file: ${filepath}`, error);
      }
    }
  }
  
  return null;
}

/**
 * Retrieves cached OCR results
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns OCR results or null if not found
 */
export function getCachedOCR(bookId: string, pageNum: number | string): OCRResult | null {
  // Always return null since we're not using the book-ocr folder
  return null;
}

/**
 * Saves OCR results to cache
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @param ocrResult OCR results to cache
 */
export function cacheOCRResult(bookId: string, pageNum: number | string, ocrResult: OCRResult): void {
  // No-op: The book-ocr folder is not needed, so we don't cache OCR results there
  // Just log that we're skipping the caching
  console.log(`Skipping OCR result caching for book ${bookId}, page ${pageNum} (book-ocr folder not used)`);
}

/**
 * Performs OCR on an image and caches the results.
 * Uses the improved OCR implementation from ocrUtils.
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier 
 * @param imagePath Path to the image file
 * @returns OCR results
 */
export async function performOCR(bookId: string, pageNum: number | string, imagePath: string): Promise<OCRResult> {
  // Check cache first
  const cachedResult = getCachedOCR(bookId, pageNum);
  if (cachedResult) {
    return cachedResult;
  }
  
  console.log(`Performing OCR on page ${pageNum} of book ${bookId} using improved OCR utility`);
  
  try {
    // Use the improved OCR implementation from ocrUtils
    const { text, confidence } = await utilsPerformOCR(imagePath);
    
    const ocrResult: OCRResult = {
      text: text,
      confidence: confidence,
      imagePath,
      pageNumber: pageNum
    };
    
    // Cache the results
    cacheOCRResult(bookId, pageNum, ocrResult);
    
    return ocrResult;
  } catch (error) {
    console.error(`OCR failed for page ${pageNum} of book ${bookId}:`, error);
    
    // Return a minimal result on error
    const errorResult: OCRResult = {
      text: 'OCR processing failed',
      confidence: 0,
      imagePath,
      pageNumber: pageNum
    };
    
    return errorResult;
  }
}

/**
 * Cleanup all non-preview images and unnecessary files for a book
 * Ensures only valid preview images remain before OCR processing
 * @param bookId Google Books volume ID
 * @returns Number of files removed
 */
function cleanupNonPreviewImages(bookId: string): number {
  try {
    console.log(`Starting thorough cleanup of non-preview images for book ${bookId}`);
    const bookDir = getBookCacheDir(bookId);
    
    if (!fs.existsSync(bookDir)) {
      console.log(`Book directory doesn't exist: ${bookDir}`);
      return 0;
    }
    
    const files = fs.readdirSync(bookDir);
    
    let removedCount = 0;
    
    // If the ocr_results.json file exists, delete it so we can regenerate it fresh
    const ocrResultsPath = path.join(bookDir, 'ocr_results.json');
    if (fs.existsSync(ocrResultsPath)) {
      try {
        fs.unlinkSync(ocrResultsPath);
        console.log(`Removed existing OCR results file to regenerate it`);
        removedCount++;
      } catch (err) {
        console.error(`Failed to remove existing OCR results file: ${err}`);
      }
    }
    
    // Pattern to detect valid preview files (preview_page_01_left.png format)
    const validPreviewPattern = /^preview_page_\d\d_(left|right)\.(png|jpg|jpeg)$/i;
    
    // Pattern to detect hash-named files that need to be removed
    const hashFilePattern = /^[0-9a-f]{32}\.(png|jpg|jpeg)$/i;
    
    // Track what types of files were removed for better reporting
    const hashFilesRemoved: string[] = [];
    const otherFilesRemoved: string[] = [];
    
    for (const file of files) {
      try {
        if (validPreviewPattern.test(file)) {
          console.log(`Keeping valid preview file: ${file}`);
        } else {
          // Remove everything that's not a valid preview image
          const filePath = path.join(bookDir, file);
          fs.unlinkSync(filePath);
          removedCount++;
          
          // Track what type of file was removed for reporting
          if (hashFilePattern.test(file)) {
            hashFilesRemoved.push(file);
          } else {
            otherFilesRemoved.push(file);
          }
        }
      } catch (err) {
        console.error(`Failed to remove file ${file}: ${err}`);
      }
    }
    
    // Log detailed removal information
    if (hashFilesRemoved.length > 0) {
      console.log(`Removed ${hashFilesRemoved.length} hash-named files:`);
      hashFilesRemoved.forEach(file => console.log(`- ${file}`));
    }
    
    if (otherFilesRemoved.length > 0) {
      console.log(`Removed ${otherFilesRemoved.length} other non-preview files:`);
      otherFilesRemoved.forEach(file => console.log(`- ${file}`));
    }
    
    console.log(`Removed ${removedCount} files from book ${bookId} in preparation for OCR`);
    return removedCount;
  } catch (error) {
    console.error(`Error cleaning up images for book ${bookId}:`, error);
    return 0;
  }
}

/**
 * Cleans a specific book ID or directory path
 * @param bookIdOrPath Book ID or absolute path to book directory
 * @returns Count of removed files
 */
export function cleanSpecificBookDirectory(bookIdOrPath: string): number {
  let bookPath: string;
  
  // Check if the provided string is a path or a book ID
  if (bookIdOrPath.startsWith('/')) {
    // It's a path
    bookPath = bookIdOrPath;
  } else {
    // It's a book ID
    bookPath = getBookCacheDir(bookIdOrPath);
  }
  
  if (!fs.existsSync(bookPath)) {
    console.log(`Directory does not exist: ${bookPath}`);
    return 0;
  }
  
  try {
    const files = fs.readdirSync(bookPath);
    let removedCount = 0;
    
    console.log(`Cleaning directory: ${bookPath}`);
    console.log(`Found ${files.length} files`);
    
    for (const file of files) {
      // Pattern to detect "preview_page#" format (with single digit, no underscore before number)
      const invalidPreviewPagePattern = /^preview_page\d+/;
      
      // Files to remove:
      // 1. Non-preview files (don't start with 'preview')
      // 2. preview_info files
      // 3. Files matching preview_page# format (single digit after 'page')
      // But keep OCR results JSON file
      if ((!file.startsWith('preview') || 
          file.includes('preview_info') ||
          invalidPreviewPagePattern.test(file)) && 
          file !== 'ocr_results.json') {
        const filePath = path.join(bookPath, file);
        try {
          fs.unlinkSync(filePath);
          removedCount++;
          console.log(`Removed: ${file}`);
        } catch (err) {
          console.error(`Failed to remove ${file}: ${err}`);
        }
      } else {
        console.log(`Keeping valid file: ${file}`);
      }
    }
    
    console.log(`Removed ${removedCount} invalid files from ${bookPath}`);
    return removedCount;
  } catch (error) {
    console.error(`Error cleaning directory ${bookPath}:`, error);
    return 0;
  }
}

/**
 * Cleans the specific directory mentioned in user query
 * Removes all files that don't start with 'preview'
 */
export function cleanYngCwAAQBAJDirectory(): number {
  const specificPath = path.join(process.cwd(), 'cache', 'book-images', 'yng_CwAAQBAJ');
  return cleanSpecificBookDirectory(specificPath);
}

/**
 * Generates a sequential set of page images from text content
 * @param bookId Google Books volume ID
 * @param content Full text content to split into pages
 * @param pageCount Number of pages to generate
 * @param startPage Starting page number
 * @returns Array of image paths and OCR results
 */
export async function generateSequentialPages(
  bookId: string, 
  content: string, 
  pageCount: number = 15, 
  startPage: number = 1
): Promise<{imagePaths: string[], ocrResults: OCRResult[]}> {
  console.log(`Generating ${pageCount} sequential pages for book ${bookId}`);
  
  // Character count per page (typical for a book page)
  const CHARS_PER_PAGE = 2000;
  
  // Split content into pages
  const pages: string[] = [];
  let remainingContent = content;
  
  for (let i = 0; i < pageCount; i++) {
    if (remainingContent.length === 0) break;
    
    // Try to find a good page break
    let endPos = Math.min(CHARS_PER_PAGE, remainingContent.length);
    
    // Try to break at paragraph
    const paragraphBreak = remainingContent.lastIndexOf('\n\n', endPos);
    if (paragraphBreak > 0 && paragraphBreak > endPos * 0.7) {
      endPos = paragraphBreak;
    } else {
      // Try to break at sentence
      const sentenceBreak = remainingContent.lastIndexOf('. ', endPos);
      if (sentenceBreak > 0 && sentenceBreak > endPos * 0.7) {
        endPos = sentenceBreak + 1; // Include the period
      } else {
        // Try to break at word
        const wordBreak = remainingContent.lastIndexOf(' ', endPos);
        if (wordBreak > 0) {
          endPos = wordBreak;
        }
      }
    }
    
    // Extract page content
    const pageContent = remainingContent.substring(0, endPos).trim();
    pages.push(pageContent);
    
    // Remove extracted content
    remainingContent = remainingContent.substring(endPos).trim();
  }
  
  // Render each page to an image - but don't perform OCR yet
  const imagePaths: string[] = [];
  const ocrResults: OCRResult[] = [];
  
  for (let i = 0; i < pages.length; i++) {
    const pageNum = startPage + i;
    const pageTitle = `Page ${pageNum}`;
    
    // Render the page - this will create sliced left/right images
    const imagePath = await renderTextToImage(bookId, pageNum, pages[i], pageTitle);
    
    // Only add the left slice to the returned paths
    if (imagePath.includes('_left')) {
      imagePaths.push(imagePath);
    }
    
    // Add a small delay to avoid overloading the system
    await setTimeout(100);
  }
  
  // First: Clean up any non-preview images
  console.log(`First step: cleaning up non-preview images for book ${bookId}`);
  cleanupNonPreviewImages(bookId);
  
  // Second: Run the OCR on all remaining preview images
  console.log(`Second step: performing OCR on preview images for book ${bookId}`);
  await ensurePreviewImagesOCR(bookId);
  
  // Now get the OCR results for each page we generated
  for (const imagePath of imagePaths) {
    // Extract page number from the image path
    const pageMatch = path.basename(imagePath).match(/page(\d+)_left/) || 
                     path.basename(imagePath).match(/preview_page_(\d+)_left/);
    
    if (pageMatch) {
      const pageNum = pageMatch[1];
      
      // The OCR should now be available from the ocr_results.json
      // Add a placeholder for now
      ocrResults.push({
        text: `OCR result for page ${pageNum}`,
        confidence: 90,
        imagePath,
        pageNumber: pageNum
      });
    }
  }
  
  return { imagePaths, ocrResults };
}

/**
 * Renders text content as a PNG image and caches it
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @param text Text content to render
 * @param title Optional title to include at the top of the image
 * @returns Path to the cached image (using descriptive name)
 */
export async function renderTextToImage(
  bookId: string, 
  pageNum: number | string, 
  text: string, 
  title?: string
): Promise<string> {
  // Get the book's cache directory
  const bookDir = getBookCacheDir(bookId);
  
  // Generate a hash of the content for duplicate detection
  const hashContent = crypto.createHash('md5').update(`${bookId}-${text}-${title || ''}`).digest('hex');
  const contentKey = `content-${hashContent}`;
  
  // Create descriptive filename patterns
  const pageIdentifier = typeof pageNum === 'number' ? `page${pageNum}` : pageNum;
  let descriptivePrefix = `${pageIdentifier}`;
  let descriptiveLeftPath = path.join(bookDir, `${descriptivePrefix}_left.png`);
  
  // Check if we have this exact content cached already (duplicate detection)
  if (processedImageSizes.has(contentKey)) {
    console.log(`Detected duplicate content hash: ${contentKey.substring(0, 10)}...`);
    
    // This exact content has been processed before, so we'll handle it as a duplicate
    // Use the page number as is if it's already in PT format, otherwise convert to PT format
    let ptPageNum: string;
    
    if (typeof pageNum === 'string' && pageNum.match(/^PT\d+$/)) {
      ptPageNum = pageNum;
    } else {
      // Start with PT1
      ptPageNum = 'PT1';
    }
    
    // Try to find the next available PT number
    let counter = 1;
    let ptExists = true;
    
    while (ptExists && counter < 100) { // Limit to PT99
      ptPageNum = `PT${counter}`;
      const ptDescriptiveLeftPath = path.join(bookDir, `${ptPageNum}_left.png`);
      
      if (!fs.existsSync(ptDescriptiveLeftPath)) {
        ptExists = false;
        break;
      }
      
      counter++;
    }
    
    // Now we have a PT page number that doesn't exist in cache
    console.log(`Using new PT number for duplicate content: ${ptPageNum}`);
    
    // Update the descriptive filenames to use the PT number
    descriptivePrefix = `${ptPageNum}`;
    descriptiveLeftPath = path.join(bookDir, `${descriptivePrefix}_left.png`);
    const descriptiveRightPath = path.join(bookDir, `${descriptivePrefix}_right.png`);
    
    // If we somehow already have this file (duplicate content but with a different source)
    // we can just return the existing path
    if (fs.existsSync(descriptiveLeftPath)) {
      console.log(`Using existing PT-numbered image for duplicate content: ${descriptiveLeftPath}`);
      return descriptiveLeftPath;
    }
    
    // Update the page number for the hash-based cache paths
    pageNum = ptPageNum;
  } else {
    // Check if we already have this exact path cached
    if (fs.existsSync(descriptiveLeftPath)) {
      console.log(`Using cached image for book ${bookId}, page ${pageNum}`);
      return descriptiveLeftPath;
    }
  }
  
  // Generate filename for the temporary full image
  const filename = generateCacheFilename(bookId, pageNum);
  const filepath = path.join(bookDir, filename);
  
  // Set up canvas dimensions (standard e-reader page size)
  const width = 600;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Border
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, width - 10, height - 10);
  
  // Text settings
  ctx.fillStyle = '#000000';
  ctx.font = '14px Arial';
  
  // Draw title if provided
  let yPosition = 40;
  if (title) {
    ctx.font = 'bold 16px Arial';
    ctx.fillText(title, 40, yPosition);
    yPosition += 30;
    
    // Add a small line under the title
    ctx.beginPath();
    ctx.moveTo(40, yPosition - 10);
    ctx.lineTo(width - 40, yPosition - 10);
    ctx.strokeStyle = '#dddddd';
    ctx.stroke();
    
    ctx.font = '14px Arial';
  }
  
  // Word wrap and render text
  const words = text.split(' ');
  let line = '';
  const maxWidth = width - 80; // 40px margins on each side
  const lineHeight = 20;
  
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    
    if (testWidth > maxWidth && i > 0) {
      ctx.fillText(line, 40, yPosition);
      line = words[i] + ' ';
      yPosition += lineHeight;
      
      // If we've reached the bottom of the page, stop rendering
      if (yPosition > height - 40) {
        break;
      }
    } else {
      line = testLine;
    }
  }
  
  // Add the last line
  if (line.trim() !== '' && yPosition <= height - 40) {
    ctx.fillText(line, 40, yPosition);
  }
  
  // Add page number at the bottom
  ctx.font = '12px Arial';
  ctx.fillStyle = '#888888';
  if (typeof pageNum === 'number') {
    ctx.fillText(`Page ${pageNum}`, width / 2 - 20, height - 30);
  } else {
    ctx.fillText(`${pageNum}`, width / 2 - 20, height - 30);
  }
  
  // Save the image to cache (temporarily)
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filepath, buffer);
  
  // Store the content hash for duplicate detection
  const imageSize = buffer.length;
  processedImageSizes.set(contentKey, imageSize);
  
  try {
    // Split the image into left and right halves
    const [leftPath, rightPath] = await splitImageInHalf(filepath, bookId, pageNum);
    
    // Delete the original image
    fs.unlinkSync(filepath);
    console.log(`Deleted original image: ${filepath}`);
    
    // Return the path to the left half (by convention)
    return leftPath;
  } catch (error) {
    console.error(`Error processing image halves: ${error}`);
    // If splitting fails, return the original image
    return filepath;
  }
}

/**
 * Downloads a book cover image, caches it, and returns the path
 * @param bookId Google Books volume ID
 * @param imageUrl URL of the book cover image
 * @returns Path to the cached image (using descriptive name)
 */
export async function cacheBookCoverImage(bookId: string, imageUrl: string): Promise<string> {
  // Get the book's cache directory
  const bookDir = getBookCacheDir(bookId);
  
  // Create descriptive filename for the cover image
  const descriptiveLeftPath = path.join(bookDir, `cover_left.png`);
  
  // Check cache first - now we'll check for the descriptive left half
  if (fs.existsSync(descriptiveLeftPath)) {
    console.log(`Using cached cover image for book ${bookId}`);
    return descriptiveLeftPath;
  }
  
  // Generate a filename for the temporary full image
  const filename = generateCacheFilename(bookId, 'cover');
  const filepath = path.join(bookDir, filename);
  
  try {
    // Download the image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'BookAnalysisService/1.0 (educational purposes)'
      },
      timeout: 15000
    });
    
    // Save to cache temporarily
    fs.writeFileSync(filepath, response.data);
    console.log(`Cached book cover image for ${bookId} at ${filepath}`);
    
    try {
      // Split the image into left and right halves
      const [leftPath, rightPath] = await splitImageInHalf(filepath, bookId, 'cover');
      
      // Delete the original image
      fs.unlinkSync(filepath);
      console.log(`Deleted original cover image: ${filepath}`);
      
      // Return the path to the left half (by convention)
      return leftPath;
    } catch (error) {
      console.error(`Error splitting cover image: ${error}`);
      // If splitting fails, return the original image
      return filepath;
    }
  } catch (error) {
    console.error(`Error downloading and caching book cover image for ${bookId}:`, error);
    throw error;
  }
}

/**
 * Caches an image from a data URI
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @param dataURI The data URI string containing the image data
 * @returns Path to the cached image file (using descriptive name)
 */
export async function cacheDataURIAsImage(bookId: string, pageNum: number | string, dataURI: string): Promise<string> {
  // Get the book's cache directory
  const bookDir = getBookCacheDir(bookId);
  
  // Create descriptive filename pattern for checking cache
  const pageIdentifier = typeof pageNum === 'number' ? `page${pageNum}` : pageNum;
  const descriptiveLeftPath = path.join(bookDir, `${pageIdentifier}_left.png`);
  
  // Check cache first - now we'll check for the descriptive left half
  if (fs.existsSync(descriptiveLeftPath)) {
    console.log(`Using cached image for book ${bookId}, page ${pageNum}`);
    return descriptiveLeftPath;
  }

  try {
    console.log(`Caching data URI as image for book ${bookId}, page ${pageNum}`);
    
    // Extract the base64 data from the data URI
    const matches = dataURI.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid data URI format');
    }
    
    // Convert base64 to buffer
    const buffer = Buffer.from(matches[2], 'base64');
    
    // Generate content hash to check for duplicate content
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');
    console.log(`Generated content hash for ${pageNum}: ${contentHash}`);
    
    // Check if we already have an image with the same content hash
    // Look through all existing files in the directory to find a match
    const existingFiles = fs.readdirSync(bookDir);
    const contentHashFile = path.join(bookDir, `${pageIdentifier}_hash.txt`);
    
    // Check for duplicate content by looking at content hash files
    for (const file of existingFiles) {
      if (file.endsWith('_hash.txt')) {
        try {
          const existingHash = fs.readFileSync(path.join(bookDir, file), 'utf8');
          if (existingHash === contentHash) {
            // Found duplicate content - get the image file name from the hash file name
            const existingPage = file.replace('_hash.txt', '');
            const existingImagePath = path.join(bookDir, `${existingPage}_left.png`);
            
            if (fs.existsSync(existingImagePath)) {
              console.log(`Found duplicate content for ${pageNum} matching existing page ${existingPage}`);
              
              // Create a symlink or just return the existing path
              return existingImagePath;
            }
          }
        } catch (err) {
          console.error(`Error reading hash file ${file}:`, err);
        }
      }
    }
    
    // Generate a unique filename for the temporary full image
    const filename = generateCacheFilename(bookId, pageNum);
    const cacheFilePath = path.join(bookDir, filename);
    
    // Write the buffer to the cache file temporarily
    fs.writeFileSync(cacheFilePath, buffer);
    console.log(`Cached image saved to ${cacheFilePath}`);
    
    // Save the content hash for future duplicate detection
    fs.writeFileSync(contentHashFile, contentHash);
    console.log(`Saved content hash to ${contentHashFile}`);
    
    try {
      // Split the image into left and right halves
      const [leftPath, rightPath] = await splitImageInHalf(cacheFilePath, bookId, pageNum);
      
      // Delete the original image
      fs.unlinkSync(cacheFilePath);
      console.log(`Deleted original image: ${cacheFilePath}`);
      
      // Return the path to the left half (by convention)
      return leftPath;
    } catch (splitError) {
      console.error(`Error splitting image for book ${bookId}, page ${pageNum}:`, splitError);
      // If splitting fails, return the original image path
      return cacheFilePath;
    }
  } catch (error) {
    console.error(`Error caching data URI as image for book ${bookId}, page ${pageNum}:`, error);
    throw error;
  }
}

/**
 * Splits an image into left and right halves
 * @param imagePath Path to the original image
 * @param bookId Google Books volume ID
 * @param pageNum Page number or identifier
 * @returns Array containing paths to the left and right halves (descriptive filenames)
 */
async function splitImageInHalf(imagePath: string, bookId: string, pageNum: number | string): Promise<[string, string]> {
  try {
    console.log(`Splitting image ${imagePath} into left and right halves`);
    
    // Get the book's cache directory
    const bookDir = getBookCacheDir(bookId);
    
    // Read the source image
    const inputBuffer = fs.readFileSync(imagePath);
    
    // Get image dimensions
    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    if (!width || !height) {
      throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }
    
    // Calculate the middle point - exactly 50% of width
    const halfWidth = Math.floor(width / 2);
    
    // Create more descriptive filenames that include page number and slice direction
    const pageIdentifier = typeof pageNum === 'number' ? `page${pageNum}` : pageNum;
    
    // Prevent duplicate "preview" prefix
    let filePrefix: string;
    
    // If the page identifier already starts with "preview", don't add it again
    if (typeof pageIdentifier === 'string' && pageIdentifier.startsWith('preview')) {
      filePrefix = pageIdentifier;
    } else {
      // If this is a page number, add it to the filename
      if (typeof pageNum === 'number') {
        filePrefix = `preview_page${pageNum}`;
      } else if (pageNum.includes('PT')) {
        // If this is a PT number, include it
        filePrefix = `preview_${pageNum}`;
      } else if (pageNum === 'cover') {
        filePrefix = `preview_cover`;
      } else {
        // Generic case - use provided page identifier
        filePrefix = `preview_${pageIdentifier}`;
      }
    }
    
    // Generate filenames for halves with preview prefix
    const descriptiveLeftPath = path.join(bookDir, `${filePrefix}_left.png`);
    const descriptiveRightPath = path.join(bookDir, `${filePrefix}_right.png`);
    
    // Generate hashed versions for compatibility
    const leftHashedFilename = generateCacheFilename(bookId, `${pageNum}-left`);
    const rightHashedFilename = generateCacheFilename(bookId, `${pageNum}-right`);
    const leftHashedPath = path.join(bookDir, leftHashedFilename);
    const rightHashedPath = path.join(bookDir, rightHashedFilename);
    
    // Create left half (0 to halfWidth)
    await sharp(inputBuffer)
      .extract({
        left: 0,
        top: 0,
        width: halfWidth,
        height: height
      })
      .png()
      .toFile(descriptiveLeftPath);
    
    // Create symbolic link or copy for hashed filename (keeping compatibility)
    if (!fs.existsSync(leftHashedPath)) {
      fs.copyFileSync(descriptiveLeftPath, leftHashedPath);
    }
    
    // Create right half (halfWidth to end)
    await sharp(inputBuffer)
      .extract({
        left: halfWidth,
        top: 0,
        width: width - halfWidth,
        height: height
      })
      .png()
      .toFile(descriptiveRightPath);
    
    // Create symbolic link or copy for hashed filename (keeping compatibility)
    if (!fs.existsSync(rightHashedPath)) {
      fs.copyFileSync(descriptiveRightPath, rightHashedPath);
    }
    
    console.log(`Successfully split image into halves:`);
    console.log(`Left: ${descriptiveLeftPath}`);
    console.log(`Right: ${descriptiveRightPath}`);
    
    // Return the descriptive paths instead of the hashed ones
    return [descriptiveLeftPath, descriptiveRightPath];
  } catch (error) {
    console.error('Error splitting image in half:', error);
    throw error;
  }
}

/**
 * Run cleanup on all book directories to ensure only valid preview images remain
 */
export function ensureOnlyPreviewImagesRemain(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      console.log(`Cache directory does not exist: ${CACHE_DIR}`);
      return;
    }
    
    const bookDirs = fs.readdirSync(CACHE_DIR);
    let totalRemoved = 0;
    
    for (const bookDir of bookDirs) {
      const bookPath = path.join(CACHE_DIR, bookDir);
      
      // Skip if not a directory
      if (!fs.statSync(bookPath).isDirectory()) {
        continue;
      }
      
      // Clean up non-preview images in this book directory
      const files = fs.readdirSync(bookPath);
      let bookRemoved = 0;
      
      for (const file of files) {
        // Pattern to detect "preview_page#" format (with single digit, no underscore before number)
        const invalidPreviewPagePattern = /^preview_page\d+/;
        
        // Files to remove:
        // 1. Non-preview files (don't start with 'preview')
        // 2. preview_info files
        // 3. Hash files (_hash.txt)
        // 4. Files matching preview_page# format (single digit after 'page')
        // But keep OCR results JSON file
        if ((!file.startsWith('preview') || 
            file.includes('preview_info') || 
            file.endsWith('_hash.txt') ||
            invalidPreviewPagePattern.test(file)) && 
            file !== 'ocr_results.json') {
          try {
            const filePath = path.join(bookPath, file);
            fs.unlinkSync(filePath);
            bookRemoved++;
            totalRemoved++;
          } catch (err) {
            console.error(`Error removing file ${file}:`, err);
          }
        } else {
          // Keep valid "preview_page_##" format files (note the underscore) and OCR results
          console.log(`Keeping valid file: ${file}`);
        }
      }
      
      if (bookRemoved > 0) {
        console.log(`Removed ${bookRemoved} invalid files from book ${bookDir}`);
      }
    }
    
    if (totalRemoved > 0) {
      console.log(`Removed a total of ${totalRemoved} invalid files from all books`);
    } else {
      console.log('No invalid files found - all clean!');
    }
  } catch (error) {
    console.error('Error ensuring only valid preview images remain:', error);
  }
}

/**
 * Clean up all cached images and OCR results
 */
export function cleanupCache(): void {
  try {
    console.log('Cleaning up expired cache files...');
    
    // Clear image cache
    if (fs.existsSync(CACHE_DIR)) {
      // Get all book directories
      const bookDirs = fs.readdirSync(CACHE_DIR);
      let totalFilesRemoved = 0;
      let totalPreviewInfoRemoved = 0;
      
      // Process each book directory
      for (const bookDir of bookDirs) {
        const bookPath = path.join(CACHE_DIR, bookDir);
        
        // Only process directories
        if (fs.statSync(bookPath).isDirectory()) {
          const allFiles = fs.readdirSync(bookPath);
          
          // Files to keep:
          // 1. Valid preview page files (preview_page_XX_left.png or preview_page_XX_right.png)
          // 2. OCR results and content analysis files
          // 3. ID mapping files
          const previewPagePattern = /^preview_page_\d+_(left|right)\.(jpg|jpeg|png)$/i;
          const essentialJsonFiles = ['ocr_results.json', 'content_analysis.json', 'id_mapping.json', 'metadata.json'];
          
          for (const file of allFiles) {
            const isEssentialJsonFile = essentialJsonFiles.includes(file.toLowerCase());
            const isValidPreviewPage = previewPagePattern.test(file);
            
            if (isEssentialJsonFile || isValidPreviewPage) {
              // Keep these files
              continue;
            } else if (file.includes('preview_info')) {
              // Remove preview_info files
              fs.unlinkSync(path.join(bookPath, file));
              totalPreviewInfoRemoved++;
            } else {
              // Remove all other files (hash-named files, etc.)
              fs.unlinkSync(path.join(bookPath, file));
              totalFilesRemoved++;
            }
          }
          
          // Remove the directory if it's empty
          const remainingFiles = fs.readdirSync(bookPath);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(bookPath);
            console.log(`Removed empty directory: ${bookPath}`);
          }
        } else {
          // Handle any loose files directly in the cache directory
          fs.unlinkSync(bookPath);
          totalFilesRemoved++;
        }
      }
      
      console.log(`Cleaned up ${totalFilesRemoved} unnecessary files and ${totalPreviewInfoRemoved} preview_info files`);
    }
  } catch (error) {
    console.error('Error cleaning up cache:', error);
  }
}

/**
 * Ensures OCR is run on all preview images after cleanup
 * This should be called after all cleaning operations are complete
 * @param bookId Google Books volume ID
 */
export async function ensurePreviewImagesOCR(bookId: string): Promise<void> {
  const bookDir = getBookCacheDir(bookId);
  
  try {
    // Check if directory exists after cleanup
    if (!fs.existsSync(bookDir)) {
      console.error(`Book directory not found after cleanup: ${bookDir}`);
      return;
    }
    
    // Get all image files in the directory after cleanup, but only those that match the preview page pattern
    const allFiles = fs.readdirSync(bookDir);
    const previewPagePattern = /^preview_page_\d+_(left|right)\.(jpg|jpeg|png)$/i;
    const validPreviewPageFiles = allFiles.filter(file => previewPagePattern.test(file));
    
    if (validPreviewPageFiles.length === 0) {
      console.log(`No valid preview page files found in ${bookDir}. OCR processing will be skipped.`);
      
      // Check if we should create an empty OCR results file
      const jsonFilePath = path.join(bookDir, 'ocr_results.json');
      if (!fs.existsSync(jsonFilePath)) {
        fs.writeFileSync(jsonFilePath, JSON.stringify([], null, 2));
        console.log(`Created empty OCR results file at ${jsonFilePath}`);
      }
      
      return;
    }
    
    console.log(`Found ${validPreviewPageFiles.length} valid preview page files to process with OCR after cleanup`);
    
    // Process the book directory with our comprehensive OCR utility
    console.log(`Running final OCR processing for preview images in ${bookDir}`);
    const success = await processBookDirectoryWithOCR(bookDir);
    
    if (success) {
      console.log(`OCR processing successfully completed for book ${bookId}`);
    } else {
      console.log(`OCR processing encountered issues for book ${bookId}, but processing continued`);
    }
  } catch (error) {
    console.error(`Error ensuring OCR for book ${bookId}:`, error);
  }
}
