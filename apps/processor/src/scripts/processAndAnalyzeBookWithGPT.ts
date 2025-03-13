#!/usr/bin/env ts-node

/**
 * Script to process book images with OCR and then analyze the OCR results with GPT-4o
 * 
 * Usage:
 * ts-node processAndAnalyzeBookWithGPT.ts [bookId|directoryPath] [--dry-run] [--env-path path/to/.env]
 * 
 * Examples:
 * - Process specific book by ID:
 *   ts-node processAndAnalyzeBookWithGPT.ts yng_CwAAQBAJ
 * 
 * - Process specific directory:
 *   ts-node processAndAnalyzeBookWithGPT.ts /full/path/to/book/directory
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { getFirstAndSecondContentPages } from '../services/bookAnalysisService';

// Load environment variables from .env file
const result = dotenv.config();

if (result.error) {
  console.warn('\x1b[33mWARNING: Could not load .env file. Error:', result.error.message, '\x1b[0m');
  console.warn('\x1b[33mWill attempt to use OPENAI_API_KEY from current environment if available.\x1b[0m');
} else {
  console.log('Successfully loaded environment variables from .env file');
}

// Check if API key is available after loading .env
if (process.env.OPENAI_API_KEY) {
  const keyStart = process.env.OPENAI_API_KEY.substring(0, 3);
  const keyEnd = process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 3);
  console.log(`Found OpenAI API key starting with "${keyStart}" and ending with "${keyEnd}"`);
} else {
  console.warn('\x1b[33mWARNING: OPENAI_API_KEY not found in environment variables.\x1b[0m');
  console.warn('\x1b[33mMake sure it is properly set in your .env file or as an environment variable.\x1b[0m');
}

// Initialize OpenAI client
let openai: OpenAI;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log('OpenAI client initialized successfully');
} catch (error) {
  console.error('Error initializing OpenAI client:', error);
}

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

/**
 * Run the OCR processing script on the book directory
 */
async function processBookWithOCR(bookPath: string): Promise<boolean> {
  console.log(`Processing book for OCR at ${bookPath}...`);
  
  // First, clean up non-preview files and then run OCR (using the same script that handles both)
  // This avoids running OCR twice since the script contains its own cleanup and OCR
  const result = spawnSync('npx', [
    'ts-node', 
    'src/scripts/processBookImagesWithOCR.ts', 
    bookPath
  ], { 
    stdio: 'inherit',
    encoding: 'utf-8'
  });
  
  if (result.status !== 0) {
    console.error(`OCR processing failed with status code ${result.status}`);
    return false;
  }
  
  console.log("OCR processing completed successfully");
  return true;
}

/**
 * Analyze OCR results to determine first and second content pages
 */
async function analyzeContentPages(bookPath: string): Promise<boolean> {
  console.log(`Analyzing content pages from OCR results at ${bookPath}...`);
  
  // Path to OCR results file
  const ocrResultsPath = path.join(bookPath, 'ocr_results.json');
  
  if (!fs.existsSync(ocrResultsPath)) {
    console.error(`OCR results file not found at ${ocrResultsPath}`);
    return false;
  }
  
  try {
    // Run the analysis
    const result = await getFirstAndSecondContentPages(ocrResultsPath);
    
    // Save the result
    const outputPath = path.join(bookPath, 'content_analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    console.log(`Content analysis completed successfully!`);
    console.log(`First and second page content saved to ${outputPath}`);
    
    return true;
  } catch (error) {
    console.error('Error analyzing book content:', error);
    return false;
  }
}

/**
 * Analyze OCR results with GPT-4o and save the results
 */
async function analyzeOCRWithGPT4o(bookPath: string): Promise<boolean> {
  // Path to OCR results file
  const ocrResultsPath = path.join(bookPath, 'ocr_results.json');
  
  if (!fs.existsSync(ocrResultsPath)) {
    console.error(`OCR results file not found at ${ocrResultsPath}`);
    return false;
  }
  
  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('\x1b[31mERROR: Cannot analyze OCR results without an OpenAI API key.\x1b[0m');
    console.error('\x1b[31mPlease provide a valid API key using the OPENAI_API_KEY environment variable:\x1b[0m');
    console.error('\x1b[31mOPENAI_API_KEY="your-actual-api-key" npx ts-node src/scripts/processAndAnalyzeBookWithGPT.ts [bookId]\x1b[0m');
    return false;
  }
  
  try {
    // Read OCR results
    const ocrResults = fs.readFileSync(ocrResultsPath, 'utf-8');
    
    console.log(`Reading OCR results from ${ocrResultsPath}`);
    
    // Create the prompt for GPT-4o
    const prompt = `
Read over each of these pages and determine which page is the first page of content (the first page of the book). Then, return the full contents of what you determine to be the "first page" of the book. In addition, return the second page of the book or what you determine to be the second page. The second page will be the index +1 of the index of what you determine the first page to be. Do not include any designators like \\n, etc. I just want the raw text but formatted excellently and without typos- this raw output is coming from an OCR, so there might be some minute errors. Fix these and return the content I ask for.

This should both be returned in structured json format. For page 1 and for page 2 in json format.

Here are the OCR results:
${ocrResults}
`;

    console.log("Sending request to GPT-4o...");
    
    try {
      // Make the API call to OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" }
      });
      
      // Extract the response
      const response = completion.choices[0].message.content;
      
      if (!response) {
        console.error("No response received from GPT-4o");
        return false;
      }
      
      // Path to save the GPT-4o response
      const gpt4oResponsePath = path.join(bookPath, 'gpt4o_response.json');
      
      // Save the response
      fs.writeFileSync(gpt4oResponsePath, response);
      
      console.log(`GPT-4o analysis saved to ${gpt4oResponsePath}`);
      return true;
    } catch (apiError: any) {
      if (apiError.code === 'invalid_api_key') {
        console.error('\x1b[31mERROR: Invalid OpenAI API key provided.\x1b[0m');
        console.error('\x1b[31mPlease provide a valid API key using the OPENAI_API_KEY environment variable:\x1b[0m');
        console.error('\x1b[31mOPENAI_API_KEY="your-actual-api-key" npx ts-node src/scripts/processAndAnalyzeBookWithGPT.ts [bookId]\x1b[0m');
      } else {
        console.error("Error calling OpenAI API:", apiError);
      }
      return false;
    }
  } catch (error) {
    console.error("Error analyzing OCR results with GPT-4o:", error);
    return false;
  }
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  
  // Check for --dry-run flag
  const dryRunIndex = args.indexOf('--dry-run');
  const isDryRun = dryRunIndex !== -1;
  
  // Remove the flag from args if present
  if (isDryRun) {
    args.splice(dryRunIndex, 1);
  }

  // Check for --env-path flag
  const envPathIndex = args.indexOf('--env-path');
  if (envPathIndex !== -1 && args.length > envPathIndex + 1) {
    const envPath = args[envPathIndex + 1];
    console.log(`Loading environment variables from custom path: ${envPath}`);
    
    // Load environment variables from custom path
    const customEnvResult = dotenv.config({ path: envPath });
    
    if (customEnvResult.error) {
      console.warn(`\x1b[33mWARNING: Could not load .env file from ${envPath}. Error: ${customEnvResult.error.message}\x1b[0m`);
    } else {
      console.log(`Successfully loaded environment variables from ${envPath}`);
      
      // Check if API key is available after loading custom .env
      if (process.env.OPENAI_API_KEY) {
        const keyStart = process.env.OPENAI_API_KEY.substring(0, 3);
        const keyEnd = process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 3);
        console.log(`Found OpenAI API key starting with "${keyStart}" and ending with "${keyEnd}"`);
      }
    }
    
    // Remove the env path flag and value from args
    args.splice(envPathIndex, 2);
  }
  
  const bookIdOrPath = args[0];
  
  if (!bookIdOrPath) {
    console.error('Error: Please provide a book ID or directory path');
    console.error('Usage: ts-node processAndAnalyzeBookWithGPT.ts [bookId|directoryPath] [--dry-run] [--env-path path/to/.env]');
    process.exit(1);
  }
  
  let bookPath: string;
  
  // Check if the provided string is a path or a book ID
  if (bookIdOrPath.startsWith('/') || bookIdOrPath.includes(':\\')) {
    // It's a path
    bookPath = bookIdOrPath;
  } else {
    // It's a book ID
    bookPath = getBookCacheDir(bookIdOrPath);
  }
  
  console.log(`Processing book at path: ${bookPath}`);
  
  if (isDryRun) {
    console.log('\x1b[33m[DRY RUN] This is a dry run. No API calls will be made to OpenAI.\x1b[0m');
  }
  
  // Check if the directory exists
  if (!fs.existsSync(bookPath)) {
    console.error(`Error: Directory does not exist: ${bookPath}`);
    process.exit(1);
  }
  
  try {
    // Check if OCR results already exist
    const ocrResultsPath = path.join(bookPath, 'ocr_results.json');
    let ocrComplete = false;
    
    if (fs.existsSync(ocrResultsPath)) {
      console.log(`OCR results already exist at ${ocrResultsPath}`);
      const stats = fs.statSync(ocrResultsPath);
      
      if (stats.size > 0) {
        console.log("Skipping OCR processing step");
        ocrComplete = true;
      } else {
        console.log("OCR results file exists but is empty, running OCR processing");
      }
    }
    
    // STEP 1: Process the book images with OCR (if needed)
    // This will handle both cleanup and OCR in a single process
    if (!ocrComplete) {
      const ocrSuccess = await processBookWithOCR(bookIdOrPath);
      
      if (!ocrSuccess) {
        console.error("Failed to process book images with OCR");
        process.exit(1);
      }
    }
    
    // STEP 2: Analyze the content to determine first and second pages
    const contentAnalysisPath = path.join(bookPath, 'content_analysis.json');
    let contentAnalysisComplete = false;
    
    if (fs.existsSync(contentAnalysisPath)) {
      console.log(`Content analysis already exists at ${contentAnalysisPath}`);
      const stats = fs.statSync(contentAnalysisPath);
      
      if (stats.size > 0) {
        console.log("Skipping content analysis step");
        contentAnalysisComplete = true;
      } else {
        console.log("Content analysis file exists but is empty, running analysis");
      }
    }
    
    if (!contentAnalysisComplete) {
      const analysisSuccess = await analyzeContentPages(bookPath);
      
      if (!analysisSuccess) {
        console.error("Failed to analyze OCR content");
        process.exit(1);
      }
    }
    
    // STEP 3: Analyze the OCR results with GPT-4o or create mock response
    // Always check if we need to run the GPT-4o step
    const gpt4oResponsePath = path.join(bookPath, 'gpt4o_response.json');
    let gpt4oComplete = false;
    
    if (fs.existsSync(gpt4oResponsePath)) {
      console.log(`GPT-4o response already exists at ${gpt4oResponsePath}`);
      const stats = fs.statSync(gpt4oResponsePath);
      
      if (stats.size > 0) {
        console.log("Skipping GPT-4o analysis step");
        gpt4oComplete = true;
      } else {
        console.log("GPT-4o response file exists but is empty, running GPT-4o analysis");
      }
    } else {
      console.log("GPT-4o response file does not exist, proceeding with GPT-4o analysis");
    }
    
    if (!gpt4oComplete) {
      let gptAnalysisSuccess = false;
      
      if (isDryRun) {
        // Create a mock GPT-4o response for dry run
        const mockResponse = JSON.stringify({
          "firstPage": {
            "text": "Chapter 1\n\nThe Beginning\n\nIt was a dark and stormy night. The rain fell in torrents, except at occasional intervals, when it was checked by a violent gust of wind which swept up the streets.",
            "index": 1
          },
          "secondPage": {
            "text": "The wind rattled against the casements, and the rain pattered dismally against the panes. The old house creaked and groaned with each gust, as if protesting the assault upon its aged frame.",
            "index": 2
          }
        }, null, 2);
        
        fs.writeFileSync(gpt4oResponsePath, mockResponse);
        console.log(`\x1b[33m[DRY RUN] Created mock GPT-4o response at ${gpt4oResponsePath}\x1b[0m`);
        gptAnalysisSuccess = true;
      } else {
        // Run actual analysis with GPT-4o
        console.log("Running GPT-4o analysis on OCR results...");
        gptAnalysisSuccess = await analyzeOCRWithGPT4o(bookPath);
      }
      
      if (!gptAnalysisSuccess) {
        console.error("Failed to analyze OCR results with GPT-4o");
        process.exit(1);
      } else {
        console.log("GPT-4o analysis completed successfully!");
      }
    }
    
    console.log("Process completed successfully!");
  } catch (error) {
    console.error('Error processing book:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 