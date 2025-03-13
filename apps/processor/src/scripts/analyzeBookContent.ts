#!/usr/bin/env ts-node

/**
 * Script to analyze book OCR results and determine first and second content pages
 * 
 * Usage:
 * ts-node analyzeBookContent.ts [bookId]
 */

import * as path from 'path';
import * as fs from 'fs';
import { getFirstAndSecondContentPages } from '../services/bookAnalysisService';
import { setupLogging, saveLogsAndRestore, logMilestone } from '../utils/logUtils';

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
    console.error('Usage: ts-node analyzeBookContent.ts [bookId]');
    process.exit(1);
  }
  
  // Set up logging for this book
  setupLogging(bookId);
  logMilestone('SCRIPT_START', 'Beginning book content analysis');
  
  // Get the book directory path
  const bookDir = getBookCacheDir(bookId);
  const ocrResultsPath = path.join(bookDir, 'ocr_results.json');
  
  // Check if OCR results exist
  if (!fs.existsSync(ocrResultsPath)) {
    console.error(`Error: OCR results file not found at ${ocrResultsPath}`);
    saveLogsAndRestore({ status: 'error', reason: 'ocr_results_not_found' });
    process.exit(1);
  }
  
  console.log(`Analyzing OCR results for book ${bookId}`);
  console.log(`OCR file path: ${ocrResultsPath}`);
  
  try {
    // Run the analysis
    logMilestone('CONTENT_ANALYSIS_START', 'Starting GPT content analysis');
    const result = await getFirstAndSecondContentPages(ocrResultsPath);
    logMilestone('CONTENT_ANALYSIS_COMPLETE', 'GPT content analysis complete');
    
    // Save the result
    const outputPath = path.join(bookDir, 'content_analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    console.log('Analysis completed successfully!');
    console.log(`Results saved to ${outputPath}`);
    
    // Display the results
    console.log('\nFirst Page Content:');
    console.log('-'.repeat(40));
    console.log(result.first_page.substring(0, 200) + '...');
    console.log('\nSecond Page Content:');
    console.log('-'.repeat(40));
    console.log(result.second_page.substring(0, 200) + '...');
    
    // Save all logs
    logMilestone('SCRIPT_COMPLETE', 'Book content analysis completed successfully');
    const logPath = saveLogsAndRestore({
      status: 'success',
      title: result.title || 'Unknown',
      author: result.author || 'Unknown',
      fiction: result.fiction,
      first_page_length: result.first_page.length,
      second_page_length: result.second_page.length
    });
    
    console.log(`Logs saved to: ${logPath}`);
  } catch (error) {
    console.error('Error analyzing book content:', error);
    logMilestone('SCRIPT_ERROR', 'Error during book content analysis');
    saveLogsAndRestore({ status: 'error', error: String(error) });
    process.exit(1);
  }
}

// Run the script
main(); 