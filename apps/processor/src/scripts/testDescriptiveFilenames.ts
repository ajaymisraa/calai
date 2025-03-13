#!/usr/bin/env ts-node

/**
 * Test script for descriptive image filenames
 * 
 * This script verifies that our image processing system creates proper descriptive filenames
 * that clearly indicate both the PT number (for duplicates) and left/right slice direction.
 * 
 * Example filenames generated:
 * - For regular content: "regular-page_left.png" and "regular-page_right.png"
 * - For duplicate 1: "PT1_left.png" and "PT1_right.png"
 * - For duplicate 2: "PT2_left.png" and "PT2_right.png"
 * 
 * Each book's files are stored in a dedicated subfolder: 
 * cache/book-images/[book-id]/page1_left.png
 * 
 * Usage:
 *   ts-node testDescriptiveFilenames.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as bookImageCache from '../services/bookImageCache';

// Let's use the actual cache directory, but with a unique test book ID
const TEST_BOOK_ID = 'test-descriptive-filename-book';

/**
 * Gets the book directory path 
 */
function getBookDir(): string {
  const cacheDir = path.join(process.cwd(), 'cache', 'book-images');
  // Sanitize the book ID to match what the cache service does
  const safeBookId = TEST_BOOK_ID.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(cacheDir, safeBookId);
}

// Clean up any existing test files before starting
function clearTestFiles() {
  const bookDir = getBookDir();
  if (!fs.existsSync(bookDir)) {
    return;
  }
  
  console.log(`Clearing previous test files from ${bookDir}...`);
  try {
    const files = fs.readdirSync(bookDir);
    let removedCount = 0;
    
    for (const file of files) {
      fs.unlinkSync(path.join(bookDir, file));
      removedCount++;
    }
    
    console.log(`Removed ${removedCount} previous test files`);
    
    // Try to remove the directory too
    if (removedCount > 0) {
      try {
        fs.rmdirSync(bookDir);
        console.log(`Removed test book directory: ${bookDir}`);
      } catch (err: any) {
        console.log(`Could not remove directory: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`Error clearing files: ${err.message}`);
  }
}

async function testDescriptiveFilenames(): Promise<void> {
  // Clear existing state and files
  clearTestFiles();
  (bookImageCache as any).processedImageSizes.clear();
  
  try {
    console.log('Testing descriptive filenames...');
    
    // Test book details - using a random suffix to ensure uniqueness
    const uniqueSuffix = Math.floor(Math.random() * 10000);
    const testText = `This is a test page with unique content ${uniqueSuffix}.`;
    
    // Test 1: Regular page (non-PT)
    console.log('\nTest 1: Regular page (non-PT)');
    const regularPage = 'regular-page';
    const normalPagePath = await bookImageCache.renderTextToImage(
      TEST_BOOK_ID, 
      regularPage, 
      testText,
      'Test Page'
    );
    
    console.log(`Rendered image path: ${normalPagePath}`);
    
    // Verify that the file is in the book's directory
    const bookDir = getBookDir();
    if (normalPagePath.startsWith(bookDir)) {
      console.log(`Success: Image is stored in the book's directory: ${bookDir}`);
    } else {
      console.error(`Error: Image is not in the expected book directory`);
      console.error(`Expected directory: ${bookDir}`);
      console.error(`Actual path: ${normalPagePath}`);
    }
    
    // Verify that the filename contains page ID and 'left'
    const filename = path.basename(normalPagePath);
    const expectedPattern = `${regularPage}_left.png`;
    if (filename === expectedPattern) {
      console.log(`Success: Filename is correct: ${filename}`);
    } else {
      console.error(`Error: Filename does not match expected pattern`);
      console.error(`Expected: ${expectedPattern}`);
      console.error(`Actual: ${filename}`);
    }
    
    // Test 2: Create a duplicate to test PT1
    console.log('\nTest 2: Creating duplicate to test PT1');
    // Use same content to trigger duplicate detection
    const duplicatePath1 = await bookImageCache.renderTextToImage(
      TEST_BOOK_ID, 
      regularPage, 
      testText,
      'Test Page'
    );
    
    console.log(`Duplicate 1 image path: ${duplicatePath1}`);
    
    // Verify PT1 in filename
    const duplicateFilename1 = path.basename(duplicatePath1);
    if (duplicateFilename1 === 'PT1_left.png') {
      console.log(`Success: Filename correctly uses PT1 format: ${duplicateFilename1}`);
    } else {
      console.error(`Error: Filename does not match expected PT1 pattern`);
      console.error(`Expected: PT1_left.png`);
      console.error(`Actual: ${duplicateFilename1}`);
    }
    
    // Test 3: Second duplicate (should be PT2)
    console.log('\nTest 3: Creating another duplicate to test PT2');
    const duplicatePath2 = await bookImageCache.renderTextToImage(
      TEST_BOOK_ID, 
      regularPage, 
      testText,
      'Test Page'
    );
    
    console.log(`Duplicate 2 image path: ${duplicatePath2}`);
    
    // Verify PT2 in filename
    const duplicateFilename2 = path.basename(duplicatePath2);
    if (duplicateFilename2 === 'PT2_left.png') {
      console.log(`Success: Filename correctly uses PT2 format: ${duplicateFilename2}`);
    } else {
      console.error(`Error: Filename does not match expected PT2 pattern`);
      console.error(`Expected: PT2_left.png`);
      console.error(`Actual: ${duplicateFilename2}`);
    }
    
    // Test 4: Check if both left and right files exist
    console.log('\nTest 4: Verifying left and right variants');
    
    // Check for both left and right versions in the book directory
    const leftFile = duplicatePath2; // This is the left file path we got
    const rightFile = path.join(path.dirname(leftFile), duplicateFilename2.replace('_left', '_right'));
    
    if (fs.existsSync(leftFile) && fs.existsSync(rightFile)) {
      console.log('Success: Both left and right files exist in the book directory');
      console.log(`Left: ${duplicateFilename2}`);
      console.log(`Right: ${path.basename(rightFile)}`);
    } else {
      console.error('Error: Left and right files not found as expected');
      console.error(`Left exists: ${fs.existsSync(leftFile)}`);
      console.error(`Right exists: ${fs.existsSync(rightFile)}`);
    }
    
    // Test 5: List all files in the book directory
    console.log('\nTest 5: Listing all files in book directory:');
    const allFiles = fs.readdirSync(getBookDir());
    for (const file of allFiles) {
      console.log(`  - ${file}`);
    }
    
    console.log('\nAll tests completed!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testDescriptiveFilenames().then(() => {
  console.log('Test script completed');
}).catch(error => {
  console.error('Test script failed:', error);
}); 