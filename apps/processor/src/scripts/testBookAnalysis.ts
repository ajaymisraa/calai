#!/usr/bin/env ts-node

/**
 * Test script to simulate the main book processing pipeline
 * 
 * Usage:
 * ts-node testBookAnalysis.ts [bookId]
 * 
 * Example:
 * ts-node testBookAnalysis.ts yng_CwAAQBAJ
 */

import * as path from 'path';
import * as fs from 'fs';
import { ensurePreviewImagesOCR } from '../services/bookImageCache';

// Default path to book-images cache
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Gets the path to a book's cache directory
 */
function getBookCacheDir(bookId: string): string {
  // Sanitize the bookId to make it safe for filesystem
  const safeBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(CACHE_DIR, safeBookId);
}

async function main() {
  // Parse arguments
  const bookId = process.argv[2];
  
  if (!bookId) {
    console.error('Error: Please provide a book ID');
    console.error('Usage: ts-node testBookAnalysis.ts [bookId]');
    process.exit(1);
  }
  
  const bookPath = getBookCacheDir(bookId);
  
  // Check if the directory exists
  if (!fs.existsSync(bookPath)) {
    console.error(`Error: Book directory does not exist: ${bookPath}`);
    process.exit(1);
  }
  
  try {
    // Trigger the ensurePreviewImagesOCR function directly which should now call GPT-4o
    console.log(`Testing OCR processing for book ${bookId}`);
    await ensurePreviewImagesOCR(bookId);
    
    // Check if content_analysis.json was created
    const analysisPath = path.join(bookPath, 'content_analysis.json');
    if (fs.existsSync(analysisPath)) {
      console.log(`GPT-4o analysis was generated successfully: ${analysisPath}`);
      const analysisContent = fs.readFileSync(analysisPath, 'utf8');
      console.log(`Analysis content: ${analysisContent}`);
    } else {
      console.error(`Error: GPT-4o analysis was not generated`);
    }
  } catch (error) {
    console.error('Error testing book analysis:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 