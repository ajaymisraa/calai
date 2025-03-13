#!/usr/bin/env ts-node

/**
 * Script to test reading content_analysis.json and verify it contains the expected data
 * 
 * Usage:
 * ts-node testContentAnalysis.ts [bookId]
 */

import * as fs from 'fs';
import * as path from 'path';

// Default path to book-images cache
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Read and verify content_analysis.json for a book
 */
async function testContentAnalysis(bookId: string): Promise<void> {
  try {
    console.log(`Testing content analysis for book: ${bookId}`);
    
    // Book directory path
    const bookDir = path.join(CACHE_DIR, bookId);
    
    // Check if book directory exists
    if (!fs.existsSync(bookDir)) {
      console.error(`Error: Book directory does not exist: ${bookDir}`);
      return;
    }
    
    // Content analysis file path
    const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
    
    // Check if content analysis file exists
    if (!fs.existsSync(contentAnalysisPath)) {
      console.error(`Error: Content analysis file does not exist: ${contentAnalysisPath}`);
      return;
    }
    
    // Read and parse content analysis file
    const contentAnalysisData = fs.readFileSync(contentAnalysisPath, 'utf8');
    const contentAnalysis = JSON.parse(contentAnalysisData);
    
    // Log content analysis data
    console.log('Content Analysis Data:');
    console.log(JSON.stringify(contentAnalysis, null, 2));
    
    // Check if content analysis has first_page and second_page
    if (!contentAnalysis.first_page) {
      console.error('Error: Content analysis does not have first_page');
    } else {
      console.log(`First page length: ${contentAnalysis.first_page.length} characters`);
      console.log(`First page excerpt: ${contentAnalysis.first_page.substring(0, 100)}...`);
    }
    
    if (!contentAnalysis.second_page) {
      console.error('Error: Content analysis does not have second_page');
    } else {
      console.log(`Second page length: ${contentAnalysis.second_page.length} characters`);
      console.log(`Second page excerpt: ${contentAnalysis.second_page.substring(0, 100)}...`);
    }
    
    // If content analysis is missing data, fix it using the fixBookContentAnalysis.ts script
    if (!contentAnalysis.first_page || !contentAnalysis.second_page) {
      console.log('Attempting to fix content analysis by running fixBookContentAnalysis.ts...');
      
      const { spawnSync } = require('child_process');
      const result = spawnSync('npx', ['ts-node', 'src/scripts/fixBookContentAnalysis.ts', bookId], {
        stdio: 'inherit',
        encoding: 'utf8'
      });
      
      if (result.status !== 0) {
        console.error(`Error running fixBookContentAnalysis.ts: ${result.error}`);
      } else {
        console.log('Fix script completed successfully. Reading updated content analysis...');
        
        // Read and parse updated content analysis file
        const updatedContentAnalysisData = fs.readFileSync(contentAnalysisPath, 'utf8');
        const updatedContentAnalysis = JSON.parse(updatedContentAnalysisData);
        
        // Log updated content analysis data
        console.log('Updated Content Analysis Data:');
        console.log(JSON.stringify(updatedContentAnalysis, null, 2));
      }
    }
    
    // Check for isNonFiction field
    console.log(`Is Non-Fiction: ${contentAnalysis.isNonFiction !== undefined ? contentAnalysis.isNonFiction : 'Not specified'}`);
    console.log(`Fiction: ${contentAnalysis.fiction !== undefined ? contentAnalysis.fiction : 'Not specified'}`);
    
  } catch (error) {
    console.error('Error testing content analysis:', error);
  }
}

// Main function to handle command line arguments
async function main() {
  // Get book ID from command line arguments
  const bookId = process.argv[2];
  
  if (!bookId) {
    console.error('Error: Please provide a book ID');
    console.error('Usage: ts-node testContentAnalysis.ts [bookId]');
    process.exit(1);
  }
  
  // Test content analysis for the specified book
  await testContentAnalysis(bookId);
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});