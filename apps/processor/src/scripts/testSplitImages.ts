#!/usr/bin/env ts-node

/**
 * Test script for image splitting functionality
 * 
 * This script tests the updated image generation and splitting functionality
 * in the bookImageCache service, including duplicate image detection.
 * 
 * Usage:
 *   ts-node testSplitImages.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as bookImageCache from '../services/bookImageCache';
import * as crypto from 'crypto';

/**
 * Deletes cached test images to start fresh
 */
function clearTestImages(bookId: string, pageIds: string[]): void {
  const cacheDir = path.join(process.cwd(), 'cache', 'book-images');
  if (!fs.existsSync(cacheDir)) {
    return;
  }

  console.log('Clearing existing test images from cache...');
  const files = fs.readdirSync(cacheDir);
  let deletedCount = 0;
  
  // Force a clean of all map caches in bookImageCache
  if (typeof (bookImageCache as any).processedImageSizes !== 'undefined') {
    (bookImageCache as any).processedImageSizes.clear();
    console.log('Cleared processedImageSizes map');
  }
  
  for (const file of files) {
    // Generate the hash for test book and page IDs to find matching files
    const hashes = pageIds.map(pageId => {
      const hash = crypto.createHash('md5').update(`${bookId}-${pageId}`).digest('hex');
      return hash;
    });
    
    // Also check for PT variants and suffixes like -left and -right
    const ptVariants = [];
    for (let i = 0; i < 10; i++) {
      const ptHash = crypto.createHash('md5').update(`${bookId}-PT${i}`).digest('hex');
      ptVariants.push(ptHash);
      
      const ptLeftHash = crypto.createHash('md5').update(`${bookId}-PT${i}-left`).digest('hex');
      ptVariants.push(ptLeftHash);
      
      const ptRightHash = crypto.createHash('md5').update(`${bookId}-PT${i}-right`).digest('hex');
      ptVariants.push(ptRightHash);
    }
    
    // Combine all hashes
    const allHashes = [...hashes, ...ptVariants];
    
    // Delete files that match our test hashes
    if (allHashes.some(hash => file.includes(hash)) || file.includes(bookId)) {
      try {
        fs.unlinkSync(path.join(cacheDir, file));
        console.log(`Deleted: ${file}`);
        deletedCount++;
      } catch (err) {
        console.error(`Error deleting ${file}:`, err);
      }
    }
  }
  console.log(`Cache cleared for test images (${deletedCount} files deleted)`);
}

async function testImageSplitting(): Promise<void> {
  console.log('Testing image splitting functionality...');
  
  // Test book ID and test text
  const testBookId = 'test-book-123';
  const testText = `
    This is a test book page. It contains multiple paragraphs of text
    that will be rendered to an image and then split into left and right halves.
    
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam auctor,
    nisl eget ultricies tincidunt, nisl nisl aliquam nisl, eget ultricies
    nisl nisl eget nisl. Nullam auctor, nisl eget ultricies tincidunt,
    nisl nisl aliquam nisl, eget ultricies nisl nisl eget nisl.
    
    This is the third paragraph with some additional text to make the
    image more interesting. It should be long enough to demonstrate the
    word wrapping and line breaking functionality.
  `;
  
  // Clear existing test images
  clearTestImages(testBookId, ['test-page-1', 'dup-test', 'PT1', 'PT2', 'PT3']);
  
  try {
    // Generate a test image with text
    console.log('Generating test image...');
    const imagePath = await bookImageCache.renderTextToImage(
      testBookId,
      'test-page-1',
      testText,
      'Test Page'
    );
    
    console.log(`Test complete! Left half image saved at: ${imagePath}`);
    
    // Verify the right half exists too
    const leftPathParts = path.parse(imagePath);
    const rightFilename = leftPathParts.name.replace('-left', '-right');
    const rightPath = path.join(leftPathParts.dir, `${rightFilename}${leftPathParts.ext}`);
    
    if (fs.existsSync(rightPath)) {
      console.log(`Right half image saved at: ${rightPath}`);
    } else {
      console.error(`Right half image not found at expected path: ${rightPath}`);
    }
    
    // Verify original image doesn't exist
    const origFilename = generateCacheFilename(testBookId, 'test-page-1');
    const origPath = path.join(process.cwd(), 'cache', 'book-images', origFilename);
    
    if (!fs.existsSync(origPath)) {
      console.log(`Success: Original image was deleted as expected: ${origPath}`);
    } else {
      console.error(`Error: Original image still exists at: ${origPath}`);
    }
    
    // Now test duplicate detection by generating the EXACT same image twice
    console.log('\nTesting duplicate image detection...');
    
    // First image - should process normally
    console.log('Generating first duplicate test image...');
    const dupImagePath1 = await bookImageCache.renderTextToImage(
      testBookId,
      'dup-test',
      testText,
      'Duplicate Test'
    );
    console.log(`First duplicate test image processed: ${dupImagePath1}`);
    
    // Second image - identical content, should detect as duplicate and increment to PT1
    console.log('Generating second duplicate test image (should be detected as duplicate)...');
    const dupImagePath2 = await bookImageCache.renderTextToImage(
      testBookId,
      'dup-test',
      testText,
      'Duplicate Test'
    );
    console.log(`Second duplicate test image processed: ${dupImagePath2}`);
    
    // Check if the second path contains PT1 in the filename
    if (dupImagePath2.includes('PT1')) {
      console.log('Success: Duplicate detection worked! Page number was incremented to PT1');
    } else {
      console.error('Error: Duplicate detection failed. Expected PT1 in filename.');
    }
    
    // Third image - still identical, should increment to PT2
    console.log('Generating third duplicate test image (should increment to PT2)...');
    const dupImagePath3 = await bookImageCache.renderTextToImage(
      testBookId,
      'dup-test',
      testText,
      'Duplicate Test'
    );
    console.log(`Third duplicate test image processed: ${dupImagePath3}`);
    
    // Check if the third path contains PT2 in the filename
    if (dupImagePath3.includes('PT2')) {
      console.log('Success: Duplicate detection worked! Page number was incremented to PT2');
    } else {
      console.error('Error: Duplicate detection failed. Expected PT2 in filename.');
    }
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Helper function to replicate the cache filename generation
function generateCacheFilename(bookId: string, pageNum: number | string): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(`${bookId}-${pageNum}`).digest('hex');
  return `${hash}.png`;
}

// Run the test
testImageSplitting().then(() => {
  console.log('Test script completed');
}).catch(error => {
  console.error('Test script failed:', error);
}); 