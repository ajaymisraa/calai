#!/usr/bin/env ts-node

/**
 * Process book images with OCR
 * 
 * This script processes all images in a book directory with OCR
 * and then analyzes the results with GPT-4o to extract content.
 * 
 * Usage:
 * ts-node processBookImagesWithOCR.ts [bookId|directoryPath]
 * 
 * Examples:
 * - Process specific book by ID:
 *   ts-node processBookImagesWithOCR.ts yng_CwAAQBAJ
 * 
 * - Process specific directory:
 *   ts-node processBookImagesWithOCR.ts /full/path/to/book/directory
 */

import * as path from 'path';
import * as fs from 'fs';
import { processBookDirectoryWithOCR } from '../utils/ocrUtils';
import { getFirstAndSecondContentPages } from '../services/bookAnalysisService';
import { setupLogging, saveLogsAndRestore, logMilestone } from '../utils/logUtils';

// Default cache directory
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Gets the path to a book's cache directory
 */
function getBookCacheDir(bookId: string): string {
  // Sanitize the bookId to make it safe for filesystem
  const safeBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(CACHE_DIR, safeBookId);
}

/**
 * Cleanup non-preview files in the book directory
 * to ensure we only process the actual book pages
 */
function cleanupNonPreviewFiles(bookPath: string): number {
  // Check if directory exists
  if (!fs.existsSync(bookPath)) {
    console.error(`Directory does not exist: ${bookPath}`);
    return 0;
  }
  
  let removedCount = 0;
  
  // Get all files in the directory
  const files = fs.readdirSync(bookPath);
  
  for (const file of files) {
    // Skip directories and specific files we want to keep
    if (
      fs.statSync(path.join(bookPath, file)).isDirectory() ||
      file === 'metadata.json' || 
      file === 'id_mapping.json' ||
      file === 'ocr_results.json' ||
      file === 'content_analysis.json' ||
      file === 'gpt4o_response.json' ||
      file.startsWith('preview_page_') ||
      file.endsWith('.log') || // Keep log files
      file.startsWith('processing_log_')
    ) {
      continue;
    }
    
    // Remove non-preview files
    try {
      fs.unlinkSync(path.join(bookPath, file));
      console.log(`Removed file: ${file}`);
      removedCount++;
    } catch (error) {
      console.error(`Error removing file ${file}:`, error);
    }
  }
  
  return removedCount;
}

async function main() {
  // Parse arguments
  const bookIdOrPath = process.argv[2];
  
  if (!bookIdOrPath) {
    console.error('Error: Please provide a book ID or directory path');
    console.error('Usage: ts-node processBookImagesWithOCR.ts [bookId|directoryPath]');
    process.exit(1);
  }
  
  let bookPath: string;
  let bookId: string;
  
  // Check if the provided string is a path or a book ID
  if (bookIdOrPath.startsWith('/') || bookIdOrPath.includes(':\\')) {
    // It's a path
    bookPath = bookIdOrPath;
    // Extract bookId from the path (last directory name)
    bookId = path.basename(bookPath);
  } else {
    // It's a book ID
    bookId = bookIdOrPath;
    bookPath = getBookCacheDir(bookIdOrPath);
  }
  
  // Set up logging for this book
  setupLogging(bookId);
  logMilestone('SCRIPT_START', 'Beginning book image OCR processing');
  
  console.log(`Processing book directory: ${bookPath}`);
  
  // Check if the directory exists
  if (!fs.existsSync(bookPath)) {
    console.error(`Error: Directory does not exist: ${bookPath}`);
    saveLogsAndRestore({ status: 'error', reason: 'directory_not_found' });
    process.exit(1);
  }
  
  try {
    // STEP 1: Clean the files
    logMilestone('CLEANUP_START', 'Cleaning up non-preview files');
    const filesRemoved = cleanupNonPreviewFiles(bookPath);
    console.log(`Step 1 complete: ${filesRemoved} files removed`);
    logMilestone('CLEANUP_COMPLETE', `Removed ${filesRemoved} non-preview files`);
    
    // STEP 2: Run OCR on the remaining files
    console.log(`=== STEP 2: Running OCR on cleaned directory ===`);
    logMilestone('OCR_START', 'Running OCR on book images');
    const success = await processBookDirectoryWithOCR(bookPath);
    
    if (success) {
      logMilestone('OCR_COMPLETE', 'OCR processing completed successfully');
      console.log(`Successfully processed all images in ${bookPath}`);
      const ocrResultsPath = path.join(bookPath, 'ocr_results.json');
      console.log(`OCR results saved to ${ocrResultsPath}`);
      
      // STEP 3: Run book analysis service to process OCR results with GPT-4o
      console.log(`=== STEP 3: Analyzing OCR results with GPT-4o ===`);
      logMilestone('CONTENT_ANALYSIS_START', 'Starting GPT content analysis');
      
      // Suppress console output except for the final result
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      const originalConsoleInfo = console.info;
      
      console.log = () => {};
      console.error = () => {};
      console.warn = () => {};
      console.info = () => {};
      
      try {
        // First, verify that the OCR results file exists and has content
        if (!fs.existsSync(ocrResultsPath)) {
          // Restore console functions first
          console.log = originalConsoleLog;
          console.error = originalConsoleError;
          console.warn = originalConsoleWarn;
          console.info = originalConsoleInfo;
          
          console.error(`ERROR: OCR results file doesn't exist at ${ocrResultsPath}`);
          logMilestone('CONTENT_ANALYSIS_ERROR', 'OCR results file missing');
          saveLogsAndRestore({
            status: 'error',
            phase: 'content_analysis',
            error: 'OCR results file missing'
          });
          process.exit(1);
        }
        
        // Also verify the OCR results file has valid content
        try {
          const ocrResultsContent = fs.readFileSync(ocrResultsPath, 'utf8');
          const ocrResults = JSON.parse(ocrResultsContent);
          
          if (!Array.isArray(ocrResults) || ocrResults.length === 0) {
            // Restore console functions
            console.log = originalConsoleLog;
            console.error = originalConsoleError;
            console.warn = originalConsoleWarn;
            console.info = originalConsoleInfo;
            
            console.error('ERROR: OCR results file exists but contains no results');
            logMilestone('CONTENT_ANALYSIS_ERROR', 'Empty OCR results');
            saveLogsAndRestore({
              status: 'error',
              phase: 'content_analysis',
              error: 'OCR results file empty'
            });
            process.exit(1);
          }
        } catch (parseError) {
          // Restore console functions
          console.log = originalConsoleLog;
          console.error = originalConsoleError;
          console.warn = originalConsoleWarn;
          console.info = originalConsoleInfo;
          
          console.error('ERROR: Failed to parse OCR results file:', parseError);
          logMilestone('CONTENT_ANALYSIS_ERROR', 'Invalid OCR results format');
          saveLogsAndRestore({
            status: 'error',
            phase: 'content_analysis',
            error: 'Invalid OCR results format'
          });
          process.exit(1);
        }
        
        // Now we're sure OCR results exist and have content, proceed with analysis
        const analysisResult = await getFirstAndSecondContentPages(ocrResultsPath);
        
        // Restore console.log for output
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        console.info = originalConsoleInfo;
        
        // Check if the results contain valid content
        if (!analysisResult.first_page || !analysisResult.second_page || 
            analysisResult.first_page === "Error extracting content" ||
            analysisResult.second_page === "Error extracting content") {
          console.error("ERROR: Content extraction failed - invalid or missing content");
          logMilestone('CONTENT_ANALYSIS_ERROR', 'Content extraction failed');
          saveLogsAndRestore({
            status: 'error',
            phase: 'content_analysis',
            error: 'Content extraction failed - invalid or missing content'
          });
          process.exit(1);
        }
        
        // Now it's safe to save the results
        const analysisPath = path.join(bookPath, 'content_analysis.json');
        fs.writeFileSync(analysisPath, JSON.stringify(analysisResult, null, 2));
        
        logMilestone('CONTENT_ANALYSIS_COMPLETE', 'Content analysis completed successfully');
        console.log(`Book analysis with GPT-4o completed successfully`);
        console.log(`Analysis results saved to ${analysisPath}`);
        console.log(`First page excerpt: ${analysisResult.first_page.substring(0, 100)}...`);
        console.log(`Second page excerpt: ${analysisResult.second_page.substring(0, 100)}...`);
        console.log(`Recommended start page: ${analysisResult.first_page ? 1 : 0}`);
        
        // Save the logs
        const logPath = saveLogsAndRestore({
          status: 'success',
          title: analysisResult.title || 'Unknown',
          author: analysisResult.author || 'Unknown', 
          fiction: analysisResult.fiction,
          first_page_length: analysisResult.first_page.length,
          second_page_length: analysisResult.second_page.length,
          files_processed: filesRemoved
        });
        
        console.log(`Processing logs saved to: ${logPath}`);
        
        // Print the result
        console.log(JSON.stringify(analysisResult));
      } catch (analysisError) {
        // Restore console functions
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        console.info = originalConsoleInfo;
        
        logMilestone('CONTENT_ANALYSIS_ERROR', 'Error during content analysis');
        console.error('Error analyzing book content with GPT-4o:', analysisError);
        
        // Save the logs with error information
        saveLogsAndRestore({
          status: 'error',
          phase: 'content_analysis',
          error: String(analysisError)
        });
      }
    } else {
      logMilestone('OCR_ERROR', 'Failed to process images with OCR');
      console.error(`Failed to process images in ${bookPath}`);
      
      // Save the logs with error information
      saveLogsAndRestore({
        status: 'error',
        phase: 'ocr_processing',
        error: 'OCR processing failed'
      });
      
      process.exit(1);
    }
  } catch (error) {
    logMilestone('SCRIPT_ERROR', 'Unhandled error during processing');
    console.error('Error processing book images:', error);
    
    // Save the logs with error information
    saveLogsAndRestore({
      status: 'error',
      phase: 'unhandled',
      error: String(error)
    });
    
    process.exit(1);
  }
}

// Run the script
main(); 