#!/usr/bin/env ts-node

/**
 * Test script for Google Books preview extraction
 * 
 * This script extracts preview pages from Google Books, splits each image into left and right halves,
 * and deletes the full images, keeping only the sliced halves for efficiency.
 * 
 * Usage:
 *   ts-node testGooglePreview.ts "[BOOK_ID]" "[WEB_READER_URL]"
 *   
 * Example:
 *   ts-node testGooglePreview.ts "wrOQLV6xB-wC" "http://play.google.com/books/reader?id=wrOQLV6xB-wC&hl=&as_pt=BOOKS&source=gbs_api"
 */

import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { extractPreviewPagesFromGoogleBooks } from '../services/googleBooksService';

// Create base cache directory if it doesn't exist
const cacheBaseDir = path.join(process.cwd(), 'cache', 'book-previews');
if (!fs.existsSync(cacheBaseDir)) {
  fs.mkdirSync(cacheBaseDir, { recursive: true });
  console.log(`Created base cache directory: ${cacheBaseDir}`);
}

/**
 * Simple direct approach to split an image into left and right halves
 */
async function splitAndSaveImageHalves(
  sourceImagePath: string, 
  leftOutputPath: string, 
  rightOutputPath: string
): Promise<boolean> {
  try {
    // Read the source image
    const inputBuffer = fs.readFileSync(sourceImagePath);
    
    // Get image dimensions
    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    if (!width || !height) {
      throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }
    
    console.log(`Source image dimensions: ${width}x${height}`);
    
    // Calculate the middle point - exactly 50% of width
    const halfWidth = Math.floor(width / 2);
    
    console.log(`Splitting at x=${halfWidth} (50% of width)`);
    
    // Create left half (0 to halfWidth)
    await sharp(inputBuffer)
      .extract({
        left: 0,
        top: 0,
        width: halfWidth,
        height: height
      })
      .jpeg({ quality: 95 })
      .toFile(leftOutputPath);
    
    console.log(`Saved left half to: ${leftOutputPath}`);
    
    // Create right half (halfWidth to end)
    await sharp(inputBuffer)
      .extract({
        left: halfWidth,
        top: 0,
        width: width - halfWidth,
        height: height
      })
      .jpeg({ quality: 95 })
      .toFile(rightOutputPath);
    
    console.log(`Saved right half to: ${rightOutputPath}`);
    
    // Verify the files were created
    if (!fs.existsSync(leftOutputPath) || !fs.existsSync(rightOutputPath)) {
      throw new Error('Failed to save image halves');
    }
    
    // Check the size of the created files
    const leftSize = fs.statSync(leftOutputPath).size;
    const rightSize = fs.statSync(rightOutputPath).size;
    
    console.log(`Left half file size: ${Math.round(leftSize / 1024)} KB`);
    console.log(`Right half file size: ${Math.round(rightSize / 1024)} KB`);
    
    if (leftSize < 1000 || rightSize < 1000) {
      throw new Error('Split image files are too small, likely empty or corrupted');
    }
    
    return true;
  } catch (error) {
    console.error('Error in splitAndSaveImageHalves:', error);
    return false;
  }
}

async function testPreviewExtraction(bookId: string, webReaderLink: string): Promise<void> {
  try {
    console.log('Testing Google Books preview extraction');
    console.log(`Book ID: ${bookId}`);
    console.log(`Web Reader Link: ${webReaderLink}`);
    console.log('This will extract 3 pages and create 6 sliced images (left and right halves)');
    
    // Create a dedicated directory for this book in the cache
    const bookCacheDir = path.join(cacheBaseDir, bookId);
    if (!fs.existsSync(bookCacheDir)) {
      fs.mkdirSync(bookCacheDir, { recursive: true });
      console.log(`Created book-specific cache directory: ${bookCacheDir}`);
    } else {
      // Clean any existing files in the directory
      const existingFiles = fs.readdirSync(bookCacheDir);
      for (const file of existingFiles) {
        if (file.endsWith('.jpg') || file.endsWith('.png')) {
          fs.unlinkSync(path.join(bookCacheDir, file));
        }
      }
      console.log(`Cleaned existing preview files from ${bookCacheDir}`);
    }
    
    // Extract preview pages
    console.log('Extracting preview pages...');
    const previewPages = await extractPreviewPagesFromGoogleBooks(bookId, webReaderLink);
    
    if (!previewPages || previewPages.length === 0) {
      console.log('No preview pages could be extracted');
      return;
    }
    
    console.log(`Successfully extracted ${previewPages.length} preview pages`);
    console.log('Processing and splitting each page into left and right halves...');
    
    // Arrays to track successful splits
    const splitResults: {left: string, right: string}[] = [];
    
    // Save and process each preview page
    for (let i = 0; i < previewPages.length; i++) {
      try {
        const pageDataURI = previewPages[i];
        const pageNumber = i + 1;
        
        // Extract base64 data from data URI
        const matches = pageDataURI.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        
        if (!matches || matches.length !== 3) {
          console.error(`Invalid data URI format for page ${pageNumber}`);
          continue;
        }
        
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Save the original (unsplit) image with a temp prefix
        const originalImagePath = path.join(bookCacheDir, `temp_original_${pageNumber}.jpg`);
        fs.writeFileSync(originalImagePath, buffer);
        console.log(`Saved original page ${pageNumber} to: ${originalImagePath}`);
        
        // Define paths for the split halves
        const leftHalfPath = path.join(bookCacheDir, `page-${String(pageNumber).padStart(3, '0')}-left.jpg`);
        const rightHalfPath = path.join(bookCacheDir, `page-${String(pageNumber).padStart(3, '0')}-right.jpg`);
        
        // Split and save the image halves
        const splitSuccess = await splitAndSaveImageHalves(originalImagePath, leftHalfPath, rightHalfPath);
        
        if (splitSuccess) {
          console.log(`Successfully split page ${pageNumber} into left and right halves`);
          splitResults.push({left: leftHalfPath, right: rightHalfPath});
          
          // Delete the original image after successful split
          fs.unlinkSync(originalImagePath);
          console.log(`Deleted original image: ${originalImagePath}`);
        } else {
          console.error(`Failed to split page ${pageNumber}`);
        }
      } catch (error) {
        console.error(`Error processing page ${i + 1}:`, error);
      }
    }
    
    // Verify results
    if (splitResults.length === 0) {
      console.error('No pages were successfully split!');
    } else {
      console.log('\nSplit results summary:');
      console.log(`Successfully split ${splitResults.length} pages into ${splitResults.length * 2} halves`);
      
      // List all the generated files
      const allFiles = fs.readdirSync(bookCacheDir);
      console.log('\nFiles in book cache directory:');
      allFiles.forEach(file => console.log(`- ${file}`));
      
      // Check for any remaining unsplit images
      const remainingOriginals = allFiles.filter(file => file.includes('temp_original_'));
      if (remainingOriginals.length > 0) {
        console.error('\nWARNING: Some original images were not deleted:');
        remainingOriginals.forEach(file => console.error(`- ${file}`));
      } else {
        console.log('\nAll original images were properly deleted');
      }
      
      console.log('\nTest completed successfully!');
      console.log(`You can find the split preview pages in: ${bookCacheDir}`);
    }
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: ts-node testGooglePreview.ts "[BOOK_ID]" "[WEB_READER_URL]"');
    
    // Provide a default example
    console.log('\nExample (Harry Potter):');
    console.log('ts-node testGooglePreview.ts "wrOQLV6xB-wC" "http://play.google.com/books/reader?id=wrOQLV6xB-wC&hl=&as_pt=BOOKS&source=gbs_api"');
    
    process.exit(1);
  }
  
  const bookId = args[0];
  const webReaderLink = args[1];
  
  await testPreviewExtraction(bookId, webReaderLink);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 