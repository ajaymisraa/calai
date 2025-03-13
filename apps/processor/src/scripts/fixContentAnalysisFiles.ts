#!/usr/bin/env ts-node

/**
 * Script to fix content_analysis.json files that are missing first_page and second_page content.
 * This script will:
 * 1. Find all book directories in the cache
 * 2. Check each content_analysis.json file
 * 3. If the file exists but is missing first_page or second_page, call getFirstAndSecondContentPages
 * 4. Update the content_analysis.json file with the results
 * 
 * Usage:
 * ts-node fixContentAnalysisFiles.ts [optional_specific_book_id]
 */

import * as path from 'path';
import * as fs from 'fs';
import { getFirstAndSecondContentPages } from '../services/bookAnalysisService';
import { setupLogging, saveLogsAndRestore, addSilentLog } from '../utils/logUtils';

// Default path to book-images cache
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

/**
 * Process a single book directory to fix its content_analysis.json file
 */
async function processBookDirectory(bookDir: string, allBookDirs: string[] = []): Promise<boolean> {
  const bookId = path.basename(bookDir);
  console.log(`Processing book: ${bookId}`);
  
  // Check if content_analysis.json exists
  const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
  let needsUpdate = false;
  
  if (!fs.existsSync(contentAnalysisPath)) {
    console.log(`${bookId} - content_analysis.json doesn't exist, will create it`);
    needsUpdate = true;
  } else {
    // Read the file to check if it's missing first_page and second_page
    try {
      const content = JSON.parse(fs.readFileSync(contentAnalysisPath, 'utf8'));
      if (!content.first_page || !content.second_page || 
          content.first_page === "Error extracting content" ||
          content.second_page === "Error extracting content") {
        console.log(`${bookId} - content_analysis.json missing valid page content, will update`);
        needsUpdate = true;
      } else {
        console.log(`${bookId} - content_analysis.json already has page content, skipping`);
        return false;
      }
    } catch (error) {
      console.error(`Error reading content_analysis.json for ${bookId}:`, error);
      needsUpdate = true;
    }
  }
  
  if (!needsUpdate) {
    return false;
  }
  
  // Try to find usable OCR results for this book
  // 1. First check in the book's own directory
  let ocrResultsPath = path.join(bookDir, 'ocr_results.json');
  let validOcrResults = false;
  
  if (fs.existsSync(ocrResultsPath)) {
    try {
      const ocrData = fs.readFileSync(ocrResultsPath, 'utf8');
      const ocrResults = JSON.parse(ocrData);
      if (Array.isArray(ocrResults) && ocrResults.length > 0) {
        validOcrResults = true;
        console.log(`Found valid OCR results in book's own directory`);
      } else {
        console.log(`OCR results exist but are empty in ${bookId}`);
      }
    } catch (error) {
      console.error(`Error reading OCR results in ${bookId}:`, error);
    }
  }
  
  // 2. If no valid OCR results found, check for mappings to other IDs
  if (!validOcrResults) {
    const mappingPath = path.join(bookDir, 'id_mapping.json');
    if (fs.existsSync(mappingPath)) {
      try {
        const mappingData = fs.readFileSync(mappingPath, 'utf8');
        const mapping = JSON.parse(mappingData);
        
        // Check if we have a Google Books ID or original ID to look up
        if (mapping.googleBooksId) {
          const altDir = path.join(path.dirname(bookDir), mapping.googleBooksId);
          const altOcrPath = path.join(altDir, 'ocr_results.json');
          
          if (fs.existsSync(altOcrPath)) {
            try {
              const altOcrData = fs.readFileSync(altOcrPath, 'utf8');
              const altOcrResults = JSON.parse(altOcrData);
              
              if (Array.isArray(altOcrResults) && altOcrResults.length > 0) {
                ocrResultsPath = altOcrPath;
                validOcrResults = true;
                console.log(`Found valid OCR results in mapped Google Books ID: ${mapping.googleBooksId}`);
              }
            } catch (error) {
              console.error(`Error reading alternate OCR results for ${mapping.googleBooksId}:`, error);
            }
          }
        } else if (mapping.originalId) {
          const altDir = path.join(path.dirname(bookDir), mapping.originalId);
          const altOcrPath = path.join(altDir, 'ocr_results.json');
          
          if (fs.existsSync(altOcrPath)) {
            try {
              const altOcrData = fs.readFileSync(altOcrPath, 'utf8');
              const altOcrResults = JSON.parse(altOcrData);
              
              if (Array.isArray(altOcrResults) && altOcrResults.length > 0) {
                ocrResultsPath = altOcrPath;
                validOcrResults = true;
                console.log(`Found valid OCR results in mapped Original ID: ${mapping.originalId}`);
              }
            } catch (error) {
              console.error(`Error reading alternate OCR results for ${mapping.originalId}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Error reading ID mapping for ${bookId}:`, error);
      }
    }
  }
  
  // 3. If still no valid OCR results, search all directories for a mapping to this ID
  if (!validOcrResults && allBookDirs.length > 0) {
    console.log(`Searching all book directories for mappings to ${bookId}...`);
    
    for (const otherDir of allBookDirs) {
      // Skip the current directory
      if (otherDir === bookDir) continue;
      
      const otherMappingPath = path.join(otherDir, 'id_mapping.json');
      if (fs.existsSync(otherMappingPath)) {
        try {
          const otherMappingData = fs.readFileSync(otherMappingPath, 'utf8');
          const otherMapping = JSON.parse(otherMappingData);
          
          // Check if this directory maps to our current book ID
          if (otherMapping.googleBooksId === bookId || otherMapping.originalId === bookId) {
            // Found a mapping, check for OCR results
            const otherOcrPath = path.join(otherDir, 'ocr_results.json');
            if (fs.existsSync(otherOcrPath)) {
              try {
                const otherOcrData = fs.readFileSync(otherOcrPath, 'utf8');
                const otherOcrResults = JSON.parse(otherOcrData);
                
                if (Array.isArray(otherOcrResults) && otherOcrResults.length > 0) {
                  ocrResultsPath = otherOcrPath;
                  validOcrResults = true;
                  console.log(`Found valid OCR results in related directory: ${path.basename(otherDir)}`);
                  break;
                }
              } catch (error) {
                console.error(`Error reading OCR results in ${otherDir}:`, error);
              }
            }
          }
        } catch (error) {
          // Ignore errors reading other mapping files
        }
      }
    }
  }
  
  // If we still don't have valid OCR results, we can't update the content analysis
  if (!validOcrResults) {
    console.log(`No valid OCR results found for ${bookId}, cannot update content_analysis.json`);
    return false;
  }
  
  console.log(`Using OCR results from: ${ocrResultsPath}`);
  
  // Now we have confirmed we need an update and have valid OCR results
  try {
    // Get existing metadata if available
    let title, author, isNonFiction;
    if (fs.existsSync(contentAnalysisPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(contentAnalysisPath, 'utf8'));
        title = existing.title;
        author = existing.author;
        // Handle both fiction and isNonFiction fields for backward compatibility
        if (existing.isNonFiction !== undefined) {
          isNonFiction = existing.isNonFiction;
        } else if (existing.fiction !== undefined) {
          isNonFiction = !existing.fiction;
        }
      } catch (e) {
        // Ignore errors, we'll proceed without metadata
      }
    }
    
    // Also check for metadata in id_mapping.json if available
    if (!title || !author) {
      const mappingPath = path.join(bookDir, 'id_mapping.json');
      if (fs.existsSync(mappingPath)) {
        try {
          const mappingData = fs.readFileSync(mappingPath, 'utf8');
          const mapping = JSON.parse(mappingData);
          
          if (mapping.originalMetadata) {
            title = title || mapping.originalMetadata.title;
            author = author || mapping.originalMetadata.author;
            
            if (isNonFiction === undefined && mapping.originalMetadata.isNonFiction !== undefined) {
              isNonFiction = mapping.originalMetadata.isNonFiction;
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }
    
    console.log(`Using metadata: title="${title || 'Unknown'}", author="${author || 'Unknown'}", isNonFiction=${isNonFiction}`);
    
    // Run the content analysis
    console.log(`Analyzing OCR results for ${bookId}...`);
    const result = await getFirstAndSecondContentPages(ocrResultsPath, title, author, isNonFiction);
    
    // Check if we got valid results
    if (!result.first_page || !result.second_page ||
        result.first_page === "Error extracting content" || 
        result.second_page === "Error extracting content") {
      console.error(`Failed to extract valid content for ${bookId}`);
      return false;
    }
    
    // Merge with existing content_analysis if it exists
    let finalContent = result;
    if (fs.existsSync(contentAnalysisPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(contentAnalysisPath, 'utf8'));
        finalContent = {
          ...existing,
          first_page: result.first_page,
          second_page: result.second_page,
          // Don't overwrite these if they already exist with good values
          title: existing.title || result.title || 'Unknown Title',
          author: existing.author || result.author || 'Unknown Author'
        };
        
        // Handle fiction/isNonFiction fields correctly
        if (result.fiction !== undefined) {
          finalContent.fiction = result.fiction;
          // Add isNonFiction field to our enhanced object
          (finalContent as any).isNonFiction = typeof result.fiction === 'boolean' ? !result.fiction : false;
        } else if (existing.fiction !== undefined) {
          // Keep existing fiction status and ensure isNonFiction is consistent
          finalContent.fiction = existing.fiction;
          (finalContent as any).isNonFiction = typeof existing.fiction === 'boolean' ? !existing.fiction : false;
        } else if (existing.isNonFiction !== undefined) {
          // Keep existing isNonFiction status and ensure fiction is consistent
          (finalContent as any).isNonFiction = existing.isNonFiction;
          finalContent.fiction = typeof existing.isNonFiction === 'boolean' ? !existing.isNonFiction : true;
        } else {
          // Default to fiction = true if nothing else is available
          finalContent.fiction = true;
          (finalContent as any).isNonFiction = false;
        }
      } catch (e) {
        // If there's an error reading/parsing the existing file, just use the new result
        finalContent = result;
        
        // Make sure both fiction and isNonFiction are set for backward compatibility
        if (result.fiction !== undefined) {
          (finalContent as any).isNonFiction = typeof result.fiction === 'boolean' ? !result.fiction : false;
        } else {
          // Default values
          finalContent.fiction = true;
          (finalContent as any).isNonFiction = false;
        }
      }
    } else {
      // Brand new content_analysis.json - make sure both fiction and isNonFiction are set
      if (result.fiction !== undefined) {
        (finalContent as any).isNonFiction = typeof result.fiction === 'boolean' ? !result.fiction : false;
      } else {
        // Default values
        finalContent.fiction = true;
        (finalContent as any).isNonFiction = false;
      }
    }
    
    // Save the updated content
    fs.writeFileSync(contentAnalysisPath, JSON.stringify(finalContent, null, 2));
    console.log(`Updated content_analysis.json for ${bookId}`);
    console.log(`First page excerpt: ${finalContent.first_page.substring(0, 100)}...`);
    console.log(`Second page excerpt: ${finalContent.second_page.substring(0, 100)}...`);
    return true;
  } catch (error) {
    console.error(`Error updating content analysis for ${bookId}:`, error);
    return false;
  }
  
  return false;
}

/**
 * Main function
 */
async function main() {
  // Check if a specific book ID was provided
  const specificBookId = process.argv[2];
  
  // Get all book directories in the cache
  let bookDirs: string[] = [];
  
  if (specificBookId) {
    // Process only the specified book
    const bookDir = path.join(CACHE_DIR, specificBookId);
    if (fs.existsSync(bookDir)) {
      bookDirs = [bookDir];
    } else {
      // Also check if there's a mapping using the specificBookId
      console.log(`Book directory not found directly: ${bookDir}, searching for mappings...`);
      
      // Get all directories to check for mappings
      const allItems = fs.readdirSync(CACHE_DIR);
      const allBookDirs = allItems
        .map(item => path.join(CACHE_DIR, item))
        .filter(itemPath => fs.statSync(itemPath).isDirectory());
      
      // Look for mappings to this book ID
      let foundMapping = false;
      for (const otherDir of allBookDirs) {
        const mappingPath = path.join(otherDir, 'id_mapping.json');
        if (fs.existsSync(mappingPath)) {
          try {
            const mappingData = fs.readFileSync(mappingPath, 'utf8');
            const mapping = JSON.parse(mappingData);
            
            if (mapping.googleBooksId === specificBookId || mapping.originalId === specificBookId) {
              console.log(`Found mapping to ${specificBookId} in directory: ${otherDir}`);
              bookDirs = [otherDir];
              foundMapping = true;
              break;
            }
          } catch (e) {
            // Ignore errors reading mapping files
          }
        }
      }
      
      if (!foundMapping) {
        console.error(`No directory found for book ID: ${specificBookId}`);
        process.exit(1);
      }
    }
  } else {
    // Process all books in the cache
    const allItems = fs.readdirSync(CACHE_DIR);
    bookDirs = allItems
      .map(item => path.join(CACHE_DIR, item))
      .filter(itemPath => fs.statSync(itemPath).isDirectory());
  }
  
  console.log(`Found ${bookDirs.length} book directories to process`);
  
  // Process each book directory
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const bookDir of bookDirs) {
    try {
      // Pass all book directories so we can look for cross-references
      const updated = await processBookDirectory(bookDir, bookDirs);
      if (updated) {
        successCount++;
      } else {
        skipCount++;
      }
    } catch (error) {
      console.error(`Error processing directory ${bookDir}:`, error);
      errorCount++;
    }
  }
  
  console.log("\nSummary:");
  console.log(`Total books: ${bookDirs.length}`);
  console.log(`Updated: ${successCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Errors: ${errorCount}`);
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});