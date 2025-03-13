#!/usr/bin/env ts-node

/**
 * Extract Google Books Preview Pages
 * 
 * This script uses the script provided by the user to extract preview pages from Google Books.
 * It will download the first 15 pages of the book preview and save them as images.
 * 
 * Usage:
 * npm run extract-preview -- "Harry Potter and the Sorcerer's Stone" "J.K. Rowling"
 * - or for Harry Potter specifically -
 * npm run extract-harry-potter
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { getBookContent } from '../services/bookService';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Get command line arguments
    const args = process.argv.slice(2);
    
    // Default to Harry Potter if no arguments provided
    let title = "Harry Potter and the Sorcerer's Stone";
    let author = "J.K. Rowling";
    
    if (args.length > 0) {
      title = args[0];
      author = args[1] || '';
    }
    
    console.log('=======================================');
    console.log(' Google Books Preview Extractor');
    console.log('=======================================');
    console.log(`Book: "${title}" by "${author || 'Unknown'}"`);
    console.log('---------------------------------------');
    
    // Create a dummy image URL as required by the API
    const dummyImageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    
    console.log('Starting extraction process...');
    console.log('1. Analyzing book metadata');
    
    // Call the getBookContent function to extract the preview
    const bookContent = await getBookContent(dummyImageUrl);
    
    // Override the metadata from image analysis with our command line arguments
    bookContent.metadata = {
      isBook: true,
      title: title,
      author: author || undefined
    };
    
    // Create output directory for debug files
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    // Create output directory for the specific book
    const bookDir = path.join(debugDir, title.replace(/[^a-z0-9]/gi, '_'));
    if (!fs.existsSync(bookDir)) {
      fs.mkdirSync(bookDir, { recursive: true });
    }
    
    // Save debug information
    fs.writeFileSync(
      path.join(bookDir, 'extraction-results.json'), 
      JSON.stringify(bookContent, null, 2)
    );
    
    console.log('2. Checking Google Books data');
    
    if (!bookContent.googleBooksData) {
      console.log('❌ No Google Books data found for this book');
      process.exit(1);
    }
    
    console.log('3. Verifying preview availability');
    
    const viewability = bookContent.googleBooksData.viewability;
    console.log(`- Preview availability: ${viewability}`);
    
    if (viewability === 'NO_PAGES') {
      console.log('❌ No preview available for this book');
      process.exit(1);
    }
    
    console.log('4. Checking extracted pages');
    
    // Check if preview pages were extracted
    if (bookContent.googleBooksData.extractedPreviewPages && 
        bookContent.googleBooksData.extractedPreviewPages.length > 0) {
      
      console.log(`✅ Successfully extracted ${bookContent.googleBooksData.extractedPreviewPages.length} preview pages!`);
      
      // Print the paths to the cached images
      console.log('Preview page paths:');
      bookContent.googleBooksData.extractedPreviewPages.forEach((imagePath, index) => {
        console.log(`- Page ${index + 1}: ${imagePath}`);
        
        // Copy the image to the debug directory for easy viewing
        try {
          const filename = `page_${String(index + 1).padStart(2, '0')}.png`;
          const debugFilePath = path.join(bookDir, filename);
          fs.copyFileSync(imagePath, debugFilePath);
          console.log(`  Copied to: ${debugFilePath}`);
        } catch (err) {
          console.error(`  Error copying file: ${err}`);
        }
      });
      
      console.log('=======================================');
      console.log('✅ Extraction complete!');
      console.log(`📂 Preview pages saved to: ${bookDir}`);
      console.log('=======================================');
    } else {
      console.log('❌ No preview pages were extracted');
      console.log('- This might be due to the book having restricted preview access');
      console.log('- Try with a different book or check if the book has a preview on Google Books');
    }
  } catch (error) {
    console.error('Error extracting preview pages:');
    console.error(error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error); 