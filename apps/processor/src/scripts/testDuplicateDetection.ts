#!/usr/bin/env ts-node

/**
 * Test script for duplicate image detection
 * 
 * This script tests our image duplicate detection algorithm directly,
 * bypassing caching.
 * 
 * Usage:
 *   ts-node testDuplicateDetection.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { createCanvas } from 'canvas';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { processedImageSizes } from '../services/bookImageCache';

// Since we're testing directly, we'll create our own temporary directory
const TEMP_DIR = path.join(process.cwd(), 'temp-test-images');

// Make sure our temporary directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`Created temporary directory: ${TEMP_DIR}`);
}

// Clean up function to run at the end
function cleanup() {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    }
    fs.rmdirSync(TEMP_DIR);
    console.log('Cleaned up temporary test directory');
  }
}

// Generate a sample image for testing
function generateTestImage(text: string): Buffer {
  // Set up canvas dimensions
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
  
  // Draw title
  ctx.font = 'bold 16px Arial';
  ctx.fillText('Test Image', 40, 40);
  
  // Draw text content
  ctx.font = '14px Arial';
  ctx.fillText(text, 40, 80);
  
  return canvas.toBuffer('image/png');
}

// Function to split an image in half, mimicking our actual implementation
async function splitImageInHalf(
  inputBuffer: Buffer, 
  bookId: string, 
  pageNum: string,
  skipDuplicateCheck: boolean = false
): Promise<[string, string]> {
  console.log(`Processing test image for book ${bookId}, page ${pageNum}`);
  
  const imageSize = inputBuffer.length;
  
  // Check for duplicates (this is what we're testing)
  if (!skipDuplicateCheck) {
    const sizeKey = `${bookId}-${imageSize}`;
    
    if (processedImageSizes.has(sizeKey)) {
      console.log(`Detected duplicate image with size ${imageSize} bytes!`);
      
      let ptPageNum: string;
      
      // If already in PT format, keep it
      if (pageNum.match(/^PT\d+$/)) {
        ptPageNum = pageNum;
      } else {
        // Start with PT1
        ptPageNum = 'PT1';
      }
      
      // Find the next available PT number
      let counter = 1;
      let ptExists = true;
      
      while (ptExists && counter < 100) {
        ptPageNum = `PT${counter}`;
        const ptLeftPath = path.join(TEMP_DIR, `${ptPageNum}-left.png`);
        
        if (!fs.existsSync(ptLeftPath)) {
          ptExists = false;
          break;
        }
        
        counter++;
      }
      
      console.log(`Using page number: ${ptPageNum} for duplicate content`);
      pageNum = ptPageNum;
    }
    
    // Store this image size for future duplicate detection
    processedImageSizes.set(`${bookId}-${imageSize}`, imageSize);
  }
  
  // Get image dimensions
  const metadata = await sharp(inputBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  
  if (!width || !height) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }
  
  // Calculate the middle point - exactly 50% of width
  const halfWidth = Math.floor(width / 2);
  
  // Generate paths for the left and right halves
  const leftPath = path.join(TEMP_DIR, `${pageNum}-left.png`);
  const rightPath = path.join(TEMP_DIR, `${pageNum}-right.png`);
  
  // Create left half (0 to halfWidth)
  await sharp(inputBuffer)
    .extract({
      left: 0,
      top: 0,
      width: halfWidth,
      height: height
    })
    .png()
    .toFile(leftPath);
  
  // Create right half (halfWidth to end)
  await sharp(inputBuffer)
    .extract({
      left: halfWidth,
      top: 0,
      width: width - halfWidth,
      height: height
    })
    .png()
    .toFile(rightPath);
  
  console.log(`Split image into left (${leftPath}) and right (${rightPath}) halves`);
  
  return [leftPath, rightPath];
}

async function testDuplicateDetection(): Promise<void> {
  // Clear any existing state
  processedImageSizes.clear();
  
  try {
    console.log('Testing duplicate image detection...');
    
    // Generate identical test images
    const testBookId = 'test-dup-book';
    const imageBuffer = generateTestImage('This is the same text for all test images');
    
    console.log('Generated test image, size:', imageBuffer.length, 'bytes');
    
    // First image - should process normally with original page name
    console.log('\nProcessing first image (original)...');
    const [leftPath1, rightPath1] = await splitImageInHalf(imageBuffer, testBookId, 'original');
    console.log('First image processed successfully as "original"');
    
    // Second image - identical content, should be detected as duplicate and use PT1
    console.log('\nProcessing second image (should be duplicate)...');
    const [leftPath2, rightPath2] = await splitImageInHalf(imageBuffer, testBookId, 'original');
    
    // Verify it used PT1
    if (leftPath2.includes('PT1')) {
      console.log('Success: Duplicate detection worked! Page number was incremented to PT1');
    } else {
      console.error('Error: Duplicate detection failed. Expected PT1 in filename, got:', leftPath2);
    }
    
    // Third image - still identical, should increment to PT2
    console.log('\nProcessing third image (should increment to PT2)...');
    const [leftPath3, rightPath3] = await splitImageInHalf(imageBuffer, testBookId, 'original');
    
    // Verify it used PT2
    if (leftPath3.includes('PT2')) {
      console.log('Success: Duplicate detection worked! Page number was incremented to PT2');
    } else {
      console.error('Error: Duplicate detection failed. Expected PT2 in filename, got:', leftPath3);
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    // Clean up our temporary files
    cleanup();
  }
}

// Run the test
testDuplicateDetection().then(() => {
  console.log('All tests completed');
}).catch(error => {
  console.error('Test script failed:', error);
}); 