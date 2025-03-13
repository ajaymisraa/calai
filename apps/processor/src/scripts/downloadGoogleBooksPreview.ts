#!/usr/bin/env ts-node

/**
 * Script to download Google Books preview pages
 * 
 * Usage:
 *   ts-node downloadGoogleBooksPreview.ts "Book Title" "Author Name"
 *   
 * Example:
 *   ts-node downloadGoogleBooksPreview.ts "Harry Potter and the Sorcerer's Stone" "J.K. Rowling"
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { searchGoogleBooks, extractPreviewPagesFromGoogleBooks } from '../services/googleBooksService';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

// Create output directory if it doesn't exist
const outputDir = path.join(process.cwd(), 'output', 'book-previews');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created output directory: ${outputDir}`);
}

async function downloadBookPreview(title: string, author: string): Promise<void> {
  try {
    console.log(`Searching for book: "${title}" by "${author}"`);
    
    // Search for the book
    const book = await searchGoogleBooks(title, author);
    
    if (!book) {
      console.error('Book not found in Google Books API');
      return;
    }
    
    console.log(`Found book: "${book.volumeInfo.title}" by ${book.volumeInfo.authors?.join(', ') || 'Unknown'}`);
    console.log(`Viewability: ${book.accessInfo.viewability}`);
    
    // Check if preview is available
    if (book.accessInfo.viewability === 'NO_PAGES') {
      console.log('No preview available for this book');
      return;
    }
    
    if (!book.accessInfo.webReaderLink) {
      console.log('No web reader link available');
      return;
    }
    
    // Create a folder for this book
    const bookId = book.id || uuidv4();
    const bookDir = path.join(outputDir, bookId);
    if (!fs.existsSync(bookDir)) {
      fs.mkdirSync(bookDir, { recursive: true });
    }
    
    // Save book metadata
    const metadata = {
      id: book.id,
      title: book.volumeInfo.title,
      subtitle: book.volumeInfo.subtitle,
      authors: book.volumeInfo.authors,
      publisher: book.volumeInfo.publisher,
      publishedDate: book.volumeInfo.publishedDate,
      description: book.volumeInfo.description,
      previewLink: book.volumeInfo.previewLink,
      webReaderLink: book.accessInfo.webReaderLink,
      viewability: book.accessInfo.viewability,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
      path.join(bookDir, 'metadata.json'), 
      JSON.stringify(metadata, null, 2)
    );
    
    console.log('Saved book metadata');
    
    // Extract preview pages
    console.log('Extracting preview pages...');
    const previewPages = await extractPreviewPagesFromGoogleBooks(
      bookId,
      book.accessInfo.webReaderLink
    );
    
    if (!previewPages || previewPages.length === 0) {
      console.log('No preview pages could be extracted');
      return;
    }
    
    console.log(`Successfully extracted ${previewPages.length} preview pages`);
    
    // Save each preview page
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
        
        const contentType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Determine file extension from content type
        let extension = 'jpg';
        if (contentType === 'image/png') extension = 'png';
        if (contentType === 'image/gif') extension = 'gif';
        
        // Save image file
        const filePath = path.join(bookDir, `page-${String(pageNumber).padStart(3, '0')}.${extension}`);
        fs.writeFileSync(filePath, buffer);
        
        console.log(`Saved page ${pageNumber} to ${filePath}`);
      } catch (error) {
        console.error(`Error saving page ${i + 1}:`, error);
      }
    }
    
    console.log(`Successfully saved ${previewPages.length} preview pages to ${bookDir}`);
    console.log('Done!');
    
  } catch (error) {
    console.error('Error downloading book preview:', error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: ts-node downloadGoogleBooksPreview.ts "Book Title" "Author Name"');
    process.exit(1);
  }
  
  const title = args[0];
  const author = args[1];
  
  await downloadBookPreview(title, author);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 