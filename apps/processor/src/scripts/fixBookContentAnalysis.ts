#!/usr/bin/env ts-node

/**
 * Script to fix content_analysis.json files with OCR cleanup
 * This script will:
 * 1. Read a book's OCR results
 * 2. Call the existing getFirstAndSecondContentPages function to clean text
 * 3. Update the content_analysis.json file with cleaned text
 * 
 * Usage:
 * ts-node fixBookContentAnalysis.ts [bookId]
 */

import * as path from 'path';
import * as fs from 'fs';
import { getFirstAndSecondContentPages } from '../services/bookAnalysisService';

// Default path to book-images cache
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Process a book's OCR results and update its content analysis
 */
async function processBook(bookId: string): Promise<void> {
  const bookDir = path.join(CACHE_DIR, bookId);
  const ocrFilePath = path.join(bookDir, 'ocr_results.json');
  const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
  
  console.log(`Processing book: ${bookId}`);
  
  // Check if the OCR file exists
  if (!fs.existsSync(ocrFilePath)) {
    console.error(`OCR results file not found at ${ocrFilePath}`);
    return;
  }
  
  try {
    // Read existing content analysis if available
    let existingAnalysis = {};
    let title = '';
    let author = '';
    let isFiction: boolean | undefined = undefined;
    
    if (fs.existsSync(contentAnalysisPath)) {
      try {
        const analysisData = await fs.promises.readFile(contentAnalysisPath, 'utf8');
        existingAnalysis = JSON.parse(analysisData);
        console.log(`Found existing content analysis for ${bookId}`);
        
        // Extract metadata from existing analysis
        title = (existingAnalysis as any).title || '';
        author = (existingAnalysis as any).author || '';
        
        // Figure out fiction status from various field names
        if ((existingAnalysis as any).fiction !== undefined) {
          isFiction = (existingAnalysis as any).fiction;
        } else if ((existingAnalysis as any).isFiction !== undefined) {
          isFiction = (existingAnalysis as any).isFiction;
        } else if ((existingAnalysis as any).isNonFiction !== undefined) {
          isFiction = !(existingAnalysis as any).isNonFiction;
        }
      } catch (err) {
        console.error(`Error reading existing analysis: ${err}`);
        // Continue with default values
      }
    }
    
    console.log(`Cleaning OCR text for book "${title || bookId}" (Fiction: ${isFiction === undefined ? 'unknown' : isFiction})`);
    
    // Call the existing function to process OCR and clean text
    const cleanedContent = await getFirstAndSecondContentPages(ocrFilePath, title, author, isFiction === false);
    
    // Merge with existing analysis
    const updatedAnalysis = {
      ...existingAnalysis,
      title: cleanedContent.title || title || "Unknown title",
      author: cleanedContent.author || author || "Unknown author",
      fiction: cleanedContent.fiction !== undefined ? cleanedContent.fiction : 
               (isFiction !== undefined ? isFiction : true),
      first_page: cleanedContent.first_page,
      second_page: cleanedContent.second_page
    };
    
    // Save the updated content analysis
    await fs.promises.writeFile(contentAnalysisPath, JSON.stringify(updatedAnalysis, null, 2));
    console.log(`Updated content analysis file for ${bookId}`);
    
    // Print small excerpts to verify
    console.log("\nFirst page excerpt:");
    console.log(cleanedContent.first_page.substring(0, 150) + '...');
    console.log("\nSecond page excerpt:");
    console.log(cleanedContent.second_page.substring(0, 150) + '...');
    
  } catch (error) {
    console.error(`Error processing book ${bookId}:`, error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Check if a book ID was provided
    const bookId = process.argv[2];
    
    if (!bookId) {
      console.error("Please provide a book ID");
      console.error("Usage: ts-node fixBookContentAnalysis.ts [bookId]");
      process.exit(1);
    }
    
    // Process the book
    await processBook(bookId);
    console.log("Done!");
    
  } catch (error) {
    console.error("Unhandled error:", error);
    process.exit(1);
  }
}

// Run the script
main();