import * as fs from 'fs';
import * as path from 'path';
import Tesseract from 'tesseract.js';

/**
 * Interface for OCR result from a single image
 */
export interface ImageOCRResult {
  imagePath: string;
  text: string;
  confidence: number;
  pageNumber: string;
  isLeftSide: boolean;
}

/**
 * Interface for combined OCR results from multiple images
 */
export interface CombinedOCRResult {
  fullText: string;
  pages: {
    pageNumber: string;
    leftText: string;
    rightText: string;
    leftConfidence: number;
    rightConfidence: number;
    leftImagePath: string;
    rightImagePath: string;
  }[];
  averageConfidence: number;
}

/**
 * Interface for OCR result from an image
 */
export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * Get all image files from a directory with extracted page info
 * @param directoryPath Path to the directory
 * @returns Array of image information objects
 */
async function getImageInfoFromDirectory(directoryPath: string): Promise<ImageInfo[]> {
  // Check if directory exists
  if (!fs.existsSync(directoryPath)) {
    console.error(`Directory not found: ${directoryPath}`);
    return [];
  }
  
  // Get all files in the directory
  const allFiles = fs.readdirSync(directoryPath);
  
  // Filter for image files with proper page naming convention
  // We only want to process files with proper naming (preview_page_XX_side.ext)
  const previewPagePattern = /^preview_page_(\d+)_(left|right)\.(jpg|jpeg|png)$/i;
  const imageFiles = allFiles.filter(file => previewPagePattern.test(file));
  
  if (imageFiles.length === 0) {
    console.warn(`No properly named page image files found in ${directoryPath}. OCR will be skipped.`);
    return [];
  }
  
  // Extract page info and sort chronologically
  const imageInfo = imageFiles.map(filename => {
    // Extract page number and side (left/right) from filename
    const match = filename.match(previewPagePattern);
    
    if (!match) {
      return null; // This should never happen due to our filter above
    }
    
    const [_, pageNum, side] = match;
    
    return {
      filename,
      pageNum: pageNum.padStart(2, '0'), // Ensure consistent padding
      side: side.toLowerCase(),
      sortKey: `${pageNum.padStart(2, '0')}_${side.toLowerCase() === 'left' ? '0' : '1'}`, // Sort left before right
      fullPath: path.join(directoryPath, filename)
    };
  }).filter(Boolean) as ImageInfo[];
  
  // Sort by page number and side (left comes before right)
  imageInfo.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  
  console.log(`Found ${imageInfo.length} properly named page images for OCR processing`);
  return imageInfo;
}

// Define interface for image info
interface ImageInfo {
  filename: string;
  pageNum: string;
  side: string;
  sortKey: string;
  fullPath: string;
}

/**
 * Process a directory of preview images in chronological order using Tesseract OCR
 * The expected naming format is preview_page_XX_[left|right].jpg
 * @param directoryPath Path to the directory containing preview images
 * @returns OCR results from processing all images in order
 */
export async function processPreviewImagesWithOCR(directoryPath: string): Promise<CombinedOCRResult> {
  try {
    console.log(`Processing preview images in ${directoryPath} with OCR`);
    
    // Check if directory exists
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`Directory not found: ${directoryPath}`);
    }
    
    // Get all files in the directory
    const allFiles = fs.readdirSync(directoryPath);
    
    // Filter for preview images with the correct naming pattern
    const previewImagePattern = /^preview_page_(\d+)_(left|right)\.(jpg|png)$/;
    const previewImages = allFiles.filter(file => previewImagePattern.test(file));
    
    if (previewImages.length === 0) {
      throw new Error('No preview images found matching the expected naming pattern');
    }
    
    console.log(`Found ${previewImages.length} preview images to process`);
    
    // Extract page info and sort chronologically (01_left, 01_right, 02_left, 02_right, etc.)
    const imageInfo = previewImages.map(filename => {
      const match = filename.match(previewImagePattern);
      if (!match) return null;
      
      const [_, pageNum, side] = match;
      return {
        filename,
        pageNum,
        side,
        sortKey: `${pageNum.padStart(2, '0')}_${side === 'left' ? '0' : '1'}`, // Ensure correct sorting
        fullPath: path.join(directoryPath, filename)
      };
    }).filter(Boolean);
    
    // Sort by page number and side (left comes before right)
    imageInfo.sort((a, b) => a!.sortKey.localeCompare(b!.sortKey));
    
    console.log('Processing images in the following order:');
    imageInfo.forEach(info => console.log(`- ${info!.filename}`));
    
    // Process each image with OCR
    const ocrResults: ImageOCRResult[] = [];
    
    // Sequential index for JSON file (0: first page left, 1: first page right, etc.)
    let sequentialIndex = 0;
    
    // Create a flat array for the JSON file with sequential indexing
    const ocrJsonData: {
      index: number;
      pageNumber: string;
      side: string;
      text: string;
      confidence: number;
      imagePath: string;
    }[] = [];
    
    for (const info of imageInfo) {
      console.log(`Performing OCR on ${info!.filename}...`);
      
      try {
        // Use the performOCR function we created
        const ocrResult = await performOCR(info!.fullPath);
        
        // Add to our full OCR results
        ocrResults.push({
          imagePath: info!.fullPath,
          text: ocrResult.text.trim(),
          confidence: ocrResult.confidence,
          pageNumber: info!.pageNum,
          isLeftSide: info!.side === 'left'
        });
        
        // Add to our sequential JSON data with proper index
        ocrJsonData.push({
          index: sequentialIndex++,
          pageNumber: info!.pageNum,
          side: info!.side,
          text: ocrResult.text.trim(),
          confidence: ocrResult.confidence,
          imagePath: info!.fullPath
        });
        
        console.log(`OCR complete for ${info!.filename} (${ocrResult.text.length} characters, ${ocrResult.confidence.toFixed(1)}% confidence)`);
      } catch (error) {
        console.error(`Error processing ${info!.filename}:`, error);
        // Continue with other images even if one fails
      }
    }
    
    // Save OCR results to JSON file
    const jsonFilePath = path.join(directoryPath, 'ocr_results.json');
    try {
      fs.writeFileSync(jsonFilePath, JSON.stringify(ocrJsonData, null, 2));
      console.log(`OCR results saved to ${jsonFilePath}`);
    } catch (error) {
      console.error('Error saving OCR results to JSON file:', error);
    }
    
    // Combine results by page
    const pageMap = new Map<string, any>();
    
    // Group by page number
    ocrResults.forEach(result => {
      if (!pageMap.has(result.pageNumber)) {
        pageMap.set(result.pageNumber, {
          pageNumber: result.pageNumber,
          leftText: result.isLeftSide ? result.text : '',
          rightText: !result.isLeftSide ? result.text : '',
          leftConfidence: result.isLeftSide ? result.confidence : 0,
          rightConfidence: !result.isLeftSide ? result.confidence : 0,
          leftImagePath: result.isLeftSide ? result.imagePath : '',
          rightImagePath: !result.isLeftSide ? result.imagePath : ''
        });
      } else {
        const pageData = pageMap.get(result.pageNumber);
        if (result.isLeftSide) {
          pageData.leftText = result.text;
          pageData.leftConfidence = result.confidence;
          pageData.leftImagePath = result.imagePath;
        } else {
          pageData.rightText = result.text;
          pageData.rightConfidence = result.confidence;
          pageData.rightImagePath = result.imagePath;
        }
      }
    });
    
    // Convert map to array and sort by page number
    const pages = Array.from(pageMap.values())
      .sort((a, b) => parseInt(a.pageNumber) - parseInt(b.pageNumber));
    
    // Calculate average confidence
    const totalConfidence = ocrResults.reduce((sum, result) => sum + result.confidence, 0);
    const averageConfidence = ocrResults.length > 0 ? totalConfidence / ocrResults.length : 0;
    
    // Combine all text in chronological order
    const fullText = pages.map(page => {
      return `Page ${page.pageNumber}:\n${page.leftText}\n${page.rightText}`.trim();
    }).join('\n\n');
    
    return {
      fullText,
      pages,
      averageConfidence
    };
  } catch (error) {
    console.error('Error processing preview images with OCR:', error);
    throw error;
  }
}

/**
 * Perform OCR on an image using Tesseract.js
 * @param imagePath Path to the image file
 * @returns Text content and confidence level
 */
export async function performOCR(imagePath: string): Promise<OcrResult> {
  try {
    console.log(`Performing OCR on ${imagePath} with Tesseract.js...`);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      console.warn(`Image file does not exist: ${imagePath}`);
      return {
        text: `[This image file (${path.basename(imagePath)}) does not exist]`,
        confidence: 0
      };
    }
    
    // Check if file is valid and has content
    const stats = fs.statSync(imagePath);
    if (stats.size === 0) {
      console.warn(`Empty image file detected: ${imagePath}. Using minimal content.`);
      return {
        text: `[Empty image: ${path.basename(imagePath)}]`,
        confidence: 0
      };
    }
    
    try {
      // This uses pure tesseract.js which doesn't require the command-line tool
      const result = await Tesseract.recognize(
        fs.readFileSync(imagePath), // Pass the image buffer
        'eng', // Language
        {
          logger: (m: any) => {
            // Uncomment to debug OCR process
            // console.log(m);
          }
        }
      );
      
      return {
        text: result.data.text.trim() || `[No text detected in ${path.basename(imagePath)}]`,
        confidence: result.data.confidence || 0
      };
    } catch (error: any) {
      console.error(`Tesseract error processing ${imagePath}:`, error);
      return {
        text: `[OCR processing failed for ${path.basename(imagePath)}: ${error.message || 'Unknown error'}]`,
        confidence: 0
      };
    }
  } catch (error) {
    console.error(`Error performing OCR on ${imagePath}:`, error);
    return {
      text: `[Error processing ${path.basename(imagePath)}]`,
      confidence: 0
    };
  }
}

/**
 * Process all images in a book directory with OCR
 * @param bookDirectoryPath Path to the book directory
 * @returns Success status
 */
export async function processBookDirectoryWithOCR(bookDirectoryPath: string): Promise<boolean> {
  try {
    console.log(`Processing all images in ${bookDirectoryPath} with OCR`);
    
    // Check if OCR has already been run on this directory
    const jsonFilePath = path.join(bookDirectoryPath, 'ocr_results.json');
    if (fs.existsSync(jsonFilePath)) {
      try {
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const parsedJson = JSON.parse(jsonContent);
        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
          console.log(`OCR already completed for this book (${parsedJson.length} pages). Skipping processing.`);
          
          // CRITICAL: Even if we skip OCR processing, we still need to ensure content_analysis.json exists
          // and has first_page and second_page fields
          const contentAnalysisPath = path.join(bookDirectoryPath, 'content_analysis.json');
          if (fs.existsSync(contentAnalysisPath)) {
            try {
              const contentAnalysisData = fs.readFileSync(contentAnalysisPath, 'utf8');
              const contentAnalysis = JSON.parse(contentAnalysisData);
              
              // Check if content_analysis.json has first_page and second_page fields
              if (!contentAnalysis.first_page || !contentAnalysis.second_page || 
                  contentAnalysis.first_page === "Error extracting content" ||
                  contentAnalysis.second_page === "Error extracting content") {
                console.log("=====================================================");
                console.log("CRITICAL: CONTENT ANALYSIS NEEDS FIRST/SECOND PAGES");
                console.log("=====================================================");
                // Generate content_analysis.json with first_page and second_page
                await generateContentAnalysisJson(bookDirectoryPath, jsonFilePath);
              } else {
                console.log("Content analysis exists and has first/second page content");
              }
            } catch (contentAnalysisError) {
              console.error("Error checking content analysis:", contentAnalysisError);
              console.log("=====================================================");
              console.log("CRITICAL: GENERATING CONTENT ANALYSIS DUE TO ERROR");
              console.log("=====================================================");
              await generateContentAnalysisJson(bookDirectoryPath, jsonFilePath);
            }
          } else {
            console.log("=====================================================");
            console.log("CRITICAL: GENERATING NEW CONTENT ANALYSIS FILE");
            console.log("=====================================================");
            await generateContentAnalysisJson(bookDirectoryPath, jsonFilePath);
          }
          
          return true;
        }
      } catch (jsonError) {
        console.log('Existing OCR results file is invalid, will reprocess OCR');
      }
    }
    
    // Get all images in the directory that match the preview page pattern
    const imageInfo = await getImageInfoFromDirectory(bookDirectoryPath);
    
    if (!imageInfo || imageInfo.length === 0) {
      console.warn('No properly named preview page files found to process with OCR. Skipping OCR processing.');
      
      // We'll create an empty OCR results file to indicate processing was attempted
      fs.writeFileSync(jsonFilePath, JSON.stringify([], null, 2));
      console.log(`Created empty OCR results file at ${jsonFilePath}`);
      
      return false;
    }
    
    console.log(`Found ${imageInfo.length} properly named preview page files for OCR`);
    
    // Display the order we're processing them in
    console.log('Processing images in the following order:');
    imageInfo.forEach((info: ImageInfo) => {
      console.log(`- ${info.filename} (Page: ${info.pageNum}, Side: ${info.side})`);
    });
    
    // Prepare to collect all OCR data in order for the JSON file
    const ocrJsonData: {
      index: number;
      filename: string;
      pageNumber: string;
      side: string;
      text: string;
      confidence: number;
      imagePath: string;
    }[] = [];
    
    // Process images sequentially
    let index = 0;
    for (const info of imageInfo) {
      console.log(`[${index + 1}/${imageInfo.length}] Performing OCR on ${info.filename}...`);
      
      try {
        // Use real OCR for all files
        const ocrResult = await performOCR(info.fullPath);
        
        // Add to our sequential JSON data
        ocrJsonData.push({
          index: index++,
          filename: info.filename,
          pageNumber: info.pageNum,
          side: info.side,
          text: ocrResult.text.trim(),
          confidence: ocrResult.confidence,
          imagePath: info.fullPath
        });
        
        console.log(`OCR complete for ${info.filename} (${ocrResult.text.length} characters, ${ocrResult.confidence.toFixed(1)}% confidence)`);
      } catch (error) {
        console.error(`Error processing ${info.filename}:`, error);
        // Continue with other images even if one fails
      }
    }
    
    // Save OCR results to JSON file
    try {
      fs.writeFileSync(jsonFilePath, JSON.stringify(ocrJsonData, null, 2));
      console.log(`OCR results saved to ${jsonFilePath}`);
      
      // Verify JSON content
      try {
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const parsedJson = JSON.parse(jsonContent);
        console.log(`JSON file contains data for ${parsedJson.length} preview pages`);
      } catch (jsonError) {
        console.error('Error verifying JSON file:', jsonError);
      }
      
      console.log("=====================================================");
      console.log("CRITICAL: AUTOMATICALLY GENERATING CONTENT ANALYSIS");
      console.log("=====================================================");
      // CRITICAL ADDITION: Immediately generate content_analysis.json
      // This ensures first_page and second_page are always extracted right after OCR
      await generateContentAnalysisJson(bookDirectoryPath, jsonFilePath);
      
      return true;
    } catch (error) {
      console.error('Error saving OCR results to JSON file:', error);
      return false;
    }
  } catch (error) {
    console.error('Error processing book directory with OCR:', error);
    return false;
  }
}

/**
 * Generate content_analysis.json from OCR results
 * This ensures the file always has first_page and second_page content
 * @param bookDirectoryPath Path to the book directory
 * @param ocrResultsPath Path to the OCR results JSON file
 */
async function generateContentAnalysisJson(bookDirectoryPath: string, ocrResultsPath: string): Promise<void> {
  try {
    console.log("CRITICAL STEP: Generating content_analysis.json with first and second pages...");
    
    // Import the function for content extraction directly
    const { getFirstAndSecondContentPages } = require('../services/bookAnalysisService');
    
    // Get existing metadata if available
    let title = '';
    let author = '';
    let isNonFiction: boolean | undefined = undefined;
    
    // Check for existing content_analysis.json
    const contentAnalysisPath = path.join(bookDirectoryPath, 'content_analysis.json');
    let existingAnalysis: any = {};
    
    if (fs.existsSync(contentAnalysisPath)) {
      try {
        const existingData = fs.readFileSync(contentAnalysisPath, 'utf8');
        existingAnalysis = JSON.parse(existingData);
        
        // Extract metadata
        title = existingAnalysis.title || '';
        author = existingAnalysis.author || '';
        
        // Determine fiction status
        if (existingAnalysis.isNonFiction !== undefined) {
          isNonFiction = existingAnalysis.isNonFiction;
        } else if (existingAnalysis.fiction !== undefined) {
          isNonFiction = !existingAnalysis.fiction;
        }
        
        console.log(`Using existing metadata from content_analysis.json: title="${title}", author="${author}", isNonFiction=${isNonFiction}`);
      } catch (parseError) {
        console.error("Error parsing existing content_analysis.json:", parseError);
      }
    }
    
    // Also check metadata.json as fallback
    if (!title || !author) {
      const metadataPath = path.join(bookDirectoryPath, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataData = fs.readFileSync(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataData);
          title = title || metadata.title || '';
          author = author || metadata.author || '';
          if (isNonFiction === undefined && metadata.isNonFiction !== undefined) {
            isNonFiction = metadata.isNonFiction;
          }
          console.log(`Using metadata from metadata.json: title="${title}", author="${author}", isNonFiction=${isNonFiction}`);
        } catch (metadataError) {
          console.error("Error reading metadata.json:", metadataError);
        }
      }
    }
    
    // Also check id_mapping.json which might have original metadata
    if (!title || !author) {
      const mappingPath = path.join(bookDirectoryPath, 'id_mapping.json');
      if (fs.existsSync(mappingPath)) {
        try {
          const mappingData = fs.readFileSync(mappingPath, 'utf8');
          const mapping = JSON.parse(mappingData);
          
          if (mapping.originalMetadata) {
            title = title || mapping.originalMetadata.title || '';
            author = author || mapping.originalMetadata.author || '';
            if (isNonFiction === undefined && mapping.originalMetadata.isNonFiction !== undefined) {
              isNonFiction = mapping.originalMetadata.isNonFiction;
            }
            console.log(`Using metadata from id_mapping.json: title="${title}", author="${author}", isNonFiction=${isNonFiction}`);
          }
        } catch (mappingError) {
          console.error("Error reading id_mapping.json:", mappingError);
        }
      }
    }
    
    // Process OCR to extract first and second content pages
    console.log("Extracting and cleaning first and second content pages with GPT-4o...");
    const extractionResult = await getFirstAndSecondContentPages(
      ocrResultsPath,
      title,
      author,
      isNonFiction
    );
    
    // Merge with existing analysis data
    const contentAnalysis = {
      ...existingAnalysis,
      title: extractionResult.title || existingAnalysis.title || title || 'Unknown Title',
      author: extractionResult.author || existingAnalysis.author || author || 'Unknown Author',
      fiction: extractionResult.fiction !== undefined ? extractionResult.fiction : 
               (existingAnalysis.fiction !== undefined ? existingAnalysis.fiction : 
                (isNonFiction !== undefined ? !isNonFiction : undefined)),
      first_page: extractionResult.first_page,
      second_page: extractionResult.second_page
    };
    
    // Ensure isNonFiction is also set for backwards compatibility
    if (contentAnalysis.fiction !== undefined && contentAnalysis.isNonFiction === undefined) {
      contentAnalysis.isNonFiction = !contentAnalysis.fiction;
    }
    
    // Save the result directly to content_analysis.json
    console.log("Saving complete content_analysis.json with first and second pages");
    fs.writeFileSync(contentAnalysisPath, JSON.stringify(contentAnalysis, null, 2));
    console.log(`Content analysis with first/second pages saved to ${contentAnalysisPath}`);
    
    // Verify the result has proper content
    if (!contentAnalysis.first_page || contentAnalysis.first_page === "Error extracting content" ||
        !contentAnalysis.second_page || contentAnalysis.second_page === "Error extracting content") {
      console.warn("WARNING: Content extraction may have issues - first/second page is missing or contains errors");
    } else {
      console.log("Content extraction successful!");
      console.log(`First page excerpt: ${contentAnalysis.first_page.substring(0, 100)}...`);
      console.log(`Second page excerpt: ${contentAnalysis.second_page.substring(0, 100)}...`);
    }
  } catch (contentError) {
    console.error("Error generating content_analysis.json:", contentError);
    // Non-fatal error - we continue even if this fails
  }
} 