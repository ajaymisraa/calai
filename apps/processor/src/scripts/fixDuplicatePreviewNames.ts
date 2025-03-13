#!/usr/bin/env ts-node

/**
 * Script to fix duplicate 'preview' prefixes in existing files
 * Renames files like preview_preview_page_01_left.png to preview_page_01_left.png
 * 
 * Usage:
 *   ts-node fixDuplicatePreviewNames.ts [bookId]
 * 
 * If no bookId is provided, it will fix all book directories
 */

import * as fs from 'fs';
import * as path from 'path';

// Main directory where book folders are stored
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

// Function to fix duplicate preview prefixes in a specific book directory
function fixDuplicatePreviewNames(bookDirPath: string): number {
  if (!fs.existsSync(bookDirPath)) {
    console.log(`Directory doesn't exist: ${bookDirPath}`);
    return 0;
  }
  
  try {
    const files = fs.readdirSync(bookDirPath);
    let renamedCount = 0;
    
    for (const file of files) {
      // Check for duplicate 'preview' prefixes
      if (file.startsWith('preview_preview_')) {
        // Create new name by removing one 'preview_' prefix
        const newName = file.replace('preview_preview_', 'preview_');
        const oldPath = path.join(bookDirPath, file);
        const newPath = path.join(bookDirPath, newName);
        
        // Rename the file
        fs.renameSync(oldPath, newPath);
        console.log(`Renamed '${file}' to '${newName}'`);
        renamedCount++;
      }
    }
    
    return renamedCount;
  } catch (error) {
    console.error(`Error fixing duplicate preview names in ${bookDirPath}:`, error);
    return 0;
  }
}

// Process specific book or all books
async function processBooks() {
  const specificBookId = process.argv[2];
  let totalRenamed = 0;
  
  if (specificBookId) {
    // Process specific book
    const bookPath = path.join(CACHE_DIR, specificBookId);
    console.log(`Processing book directory: ${specificBookId}`);
    
    const renamedCount = fixDuplicatePreviewNames(bookPath);
    console.log(`Renamed ${renamedCount} files in book ${specificBookId}`);
    totalRenamed += renamedCount;
  } else {
    // Process all books
    if (!fs.existsSync(CACHE_DIR)) {
      console.log(`Cache directory doesn't exist: ${CACHE_DIR}`);
      return;
    }
    
    const bookDirs = fs.readdirSync(CACHE_DIR);
    console.log(`Found ${bookDirs.length} book directories`);
    
    for (const bookDir of bookDirs) {
      const bookPath = path.join(CACHE_DIR, bookDir);
      
      // Skip non-directories
      if (!fs.statSync(bookPath).isDirectory()) {
        continue;
      }
      
      console.log(`Processing book directory: ${bookDir}`);
      const renamedCount = fixDuplicatePreviewNames(bookPath);
      console.log(`Renamed ${renamedCount} files in book ${bookDir}`);
      totalRenamed += renamedCount;
    }
  }
  
  console.log(`Total files renamed: ${totalRenamed}`);
}

// Run the script
processBooks().catch(err => {
  console.error('Error:', err);
  process.exit(1);
}); 