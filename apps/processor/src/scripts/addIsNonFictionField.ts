#!/usr/bin/env ts-node

/**
 * Script to add missing isNonFiction field to content_analysis.json files
 * 
 * Usage:
 * ts-node addIsNonFictionField.ts [bookId]
 */

import * as fs from 'fs';
import * as path from 'path';

// Default path to book-images cache
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Add isNonFiction field to content_analysis.json
 */
async function addIsNonFictionField(bookId: string): Promise<void> {
  try {
    console.log(`Adding isNonFiction field for book: ${bookId}`);
    
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
    
    // Check if fiction field exists
    if (contentAnalysis.fiction === undefined) {
      console.error('Error: Content analysis does not have fiction field');
      return;
    }
    
    // Add isNonFiction field based on fiction field
    contentAnalysis.isNonFiction = !contentAnalysis.fiction;
    
    // Write updated content analysis file
    fs.writeFileSync(contentAnalysisPath, JSON.stringify(contentAnalysis, null, 2));
    
    console.log('Successfully updated content analysis with isNonFiction field');
    console.log('Updated Content Analysis Data:');
    console.log(JSON.stringify(contentAnalysis, null, 2));
    
  } catch (error) {
    console.error('Error adding isNonFiction field:', error);
  }
}

// Main function to handle command line arguments
async function main() {
  // Get book ID from command line arguments
  const bookId = process.argv[2];
  
  if (!bookId) {
    console.error('Error: Please provide a book ID');
    console.error('Usage: ts-node addIsNonFictionField.ts [bookId]');
    process.exit(1);
  }
  
  // Add isNonFiction field for the specified book
  await addIsNonFictionField(bookId);
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});