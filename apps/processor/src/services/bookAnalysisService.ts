import OpenAI from 'openai';
import dotenv from 'dotenv';
import { OCRResult } from './bookImageCache';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Initialize OpenAI with error handling
let openai: OpenAI;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-initialization'
  });
} catch (error) {
  // Create a dummy client that will show clearer errors when methods are called
  openai = new OpenAI({
    apiKey: 'dummy-key-for-initialization'
  });
}

/**
 * Interface for content analysis results
 */
export interface ContentAnalysisResult {
  firstContentPage: number;
  isNonFiction: boolean;
  confidence: number;
  pageInsights: {
    pageNumber: number;
    isFrontMatter: boolean;
    isMainContent: boolean;
    contentType: string;
    summary: string;
  }[];
  recommendedStartPage: number;
}

/**
 * Interface for the simplified first and second page content
 */
export interface SimpleContentResult {
  title?: string;
  author?: string;
  fiction?: boolean;
  first_page: string;
  second_page: string;
}

/**
 * Clean OCR text to make it read better
 * @param text Raw OCR text
 * @returns Cleaned text
 */
function cleanOCRText(text: string): string {
  // Remove OCR artifacts and common noise
  let cleaned = text
    .replace(/\[.*?\]/g, '') // Remove bracketed text like [3 The Subtle Art...]
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .replace(/\s{2,}/g, ' ') // Replace multiple spaces with single space
    .replace(/ful se: tex toc he mc Signin/g, '') // Remove common OCR artifacts
    .replace(/—P Crrrrreressrereeeeeseeseessreeeee "eye eee.../g, '')
    .replace(/i\. I EVE ro/g, '')
    .replace(/i IS TT/g, '')
    .replace(/ee EE VAT/g, '')
    .replace(/Q ee/g, '')
    .trim();
  
  return cleaned;
}

/**
 * Read OCR results from a JSON file
 * @param filePath Path to the OCR results JSON file
 * @returns Array of OCR results
 */
export async function readOCRResultsFromFile(filePath: string): Promise<OCRResult[]> {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    const ocrResults: OCRResult[] = JSON.parse(data);
    return ocrResults;
  } catch (error) {
    throw new Error(`Failed to read OCR results from ${filePath}`);
  }
}

/**
 * Analyze OCR results to find the first content page and classify the book
 * @param bookId Book identifier
 * @param ocrResults Array of OCR results for sequential pages
 * @param title Book title if known
 * @param author Book author if known
 * @param isNonFiction Whether the book is non-fiction if known
 * @returns Analysis of content with first content page identified
 */
export async function analyzeBookContent(
  bookId: string,
  ocrResults: OCRResult[],
  title?: string,
  author?: string,
  isNonFiction?: boolean
): Promise<ContentAnalysisResult & { 
  title: string; 
  author: string; 
  fiction: boolean;
  first_page: string;
  second_page: string;
}> {
  if (!ocrResults.length) {
    throw new Error('No OCR results provided for analysis');
  }
  
  try {
    // Prepare the pages content for analysis
    const pageTexts = ocrResults.map((result, index) => {
      return {
        pageNumber: typeof result.pageNumber === 'number' ? result.pageNumber : index + 1,
        text: result.text.trim().substring(0, 1000) // Trim to first 1000 chars for API efficiency
      };
    });
    
    // Create a filename to save metadata separately
    const metadataFilePath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'content_analysis.json');
    
    // Use known values for fiction status if provided
    const fictionStatus = isNonFiction !== undefined ? !isNonFiction : undefined;
    
    // Call GPT-4o to analyze the content
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert in book analysis and structure. Your task is to analyze book pages to identify the first true content page (after front matter like title page, copyright, table of contents, etc.) and determine if the book is fiction or non-fiction.

For fiction books, the first content page is typically the beginning of Chapter 1 or the Prologue.
For non-fiction books, the first content page is the beginning of the Introduction or Chapter 1.

IMPORTANT: You must include the book title, author, and fiction status in your response, exactly as provided in the input, or your best determination if not provided.

Remember that OCR text may contain artifacts or errors. Focus on identifying meaningful content and ignoring OCR-related noise.`
        },
        {
          role: 'user',
          content: `Analyze these ${pageTexts.length} consecutive pages from a book${title ? ` titled "${title}"` : ''}${author ? ` by ${author}` : ''}. For each page, determine if it's front matter or main content, and what type of content it contains.

${fictionStatus !== undefined ? `This book is ${fictionStatus ? 'fiction' : 'non-fiction'}. ` : ''}

Pages content:
${pageTexts.map(p => `--- Page ${p.pageNumber} ---\n${p.text}\n`).join('\n')}

Provide a JSON response with:
1. title: The book title, use "${title || 'Unknown Title'}" if provided or your best determination based on content
2. author: The book author, use "${author || 'Unknown Author'}" if provided or your best determination based on content
3. fiction: ${fictionStatus !== undefined ? fictionStatus : 'Boolean indicating if this appears to be fiction (true for fiction, false for non-fiction)'}
4. firstContentPage: The page number where the actual content begins (after dedication, TOC, etc.)
5. isNonFiction: ${isNonFiction !== undefined ? isNonFiction : 'Boolean indicating if this appears to be non-fiction'}
6. confidence: Your confidence level (0-1)
7. pageInsights: Array with analysis of each page
8. recommendedStartPage: The page readers should start from`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 3000
    });
    
    if (!response.choices[0].message.content) {
      throw new Error('Empty response from content analysis');
    }
    
    // Parse the response
    const parsedResponse = JSON.parse(response.choices[0].message.content);
    
    // Create a temporary OCR results file to pass to getFirstAndSecondContentPages
    const tempOCRFilePath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'temp_ocr.json');
    await fs.promises.writeFile(tempOCRFilePath, JSON.stringify(ocrResults, null, 2));
    
    // Get the full, clean text for the first and second content pages
    let firstAndSecondPages;
    try {
      firstAndSecondPages = await getFirstAndSecondContentPages(
        tempOCRFilePath,
        title || parsedResponse.title,
        author || parsedResponse.author,
        isNonFiction !== undefined ? isNonFiction : parsedResponse.isNonFiction
      );
      
      // Clean up the temporary file
      await fs.promises.unlink(tempOCRFilePath);
    } catch (pageError) {
      console.error('Error getting first and second pages:', pageError);
      firstAndSecondPages = {
        first_page: '',
        second_page: ''
      };
    }
    
    // Create a more complete analysis result that includes the book metadata and full page content
    const analysisResult: ContentAnalysisResult & { 
      title: string; 
      author: string; 
      fiction: boolean;
      first_page: string;
      second_page: string;
    } = {
      firstContentPage: parsedResponse.firstContentPage || 1,
      isNonFiction: isNonFiction !== undefined ? isNonFiction : (parsedResponse.isNonFiction || false),
      confidence: parsedResponse.confidence || 0,
      pageInsights: parsedResponse.pageInsights || [],
      recommendedStartPage: parsedResponse.recommendedStartPage || 1,
      title: title || parsedResponse.title || firstAndSecondPages.title || 'Unknown Title',
      author: author || parsedResponse.author || firstAndSecondPages.author || 'Unknown Author',
      fiction: fictionStatus !== undefined ? fictionStatus : (
        firstAndSecondPages.fiction !== undefined ? firstAndSecondPages.fiction : 
        (parsedResponse.fiction ?? !parsedResponse.isNonFiction ?? true)
      ),
      // Use the full page content from getFirstAndSecondContentPages
      first_page: firstAndSecondPages.first_page || '',
      second_page: firstAndSecondPages.second_page || ''
    };
    
    // Write the metadata directly to the content_analysis.json file
    try {
      await fs.promises.writeFile(metadataFilePath, JSON.stringify(analysisResult, null, 2));
      console.log(`Book content automatically analyzed with GPT-4o`);
      console.log(`Analysis results saved to ${metadataFilePath}`);
    } catch (fileError) {
      console.error('Error saving content analysis file:', fileError);
    }
    
    return analysisResult;
  } catch (error) {
    // For the fallback, still try to get the full page content
    let firstAndSecondPages = {
      first_page: ocrResults[0]?.text || '',
      second_page: ocrResults[1]?.text || ''
    };
    
    // Attempt to clean the pages using getFirstAndSecondContentPages if possible
    try {
      // Create a temporary OCR results file
      const tempOCRFilePath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'temp_ocr.json');
      await fs.promises.writeFile(tempOCRFilePath, JSON.stringify(ocrResults, null, 2));
      
      const cleanPages = await getFirstAndSecondContentPages(
        tempOCRFilePath,
        title,
        author,
        isNonFiction
      );
      
      // Use the clean pages if available
      firstAndSecondPages = {
        first_page: cleanPages.first_page || firstAndSecondPages.first_page,
        second_page: cleanPages.second_page || firstAndSecondPages.second_page
      };
      
      // Clean up the temporary file
      await fs.promises.unlink(tempOCRFilePath);
    } catch (pageError) {
      console.error('Error getting clean first and second pages for fallback:', pageError);
    }
    
    // Prepare a fallback result that includes title and author
    const fallbackResult: ContentAnalysisResult & {
      title: string;
      author: string;
      fiction: boolean;
      first_page: string;
      second_page: string;
    } = {
      firstContentPage: 1, // Default to first page
      isNonFiction: isNonFiction !== undefined ? isNonFiction : false, // Use provided value or default to fiction
      confidence: 0,
      pageInsights: ocrResults.map((result, index) => ({
        pageNumber: typeof result.pageNumber === 'number' ? result.pageNumber : index + 1,
        isFrontMatter: index < 2, // Assume first two pages are front matter
        isMainContent: index >= 2, // Assume content starts at page 3
        contentType: index < 2 ? 'Unknown front matter' : 'Unknown main content',
        summary: 'Analysis failed'
      })),
      recommendedStartPage: 1, // Default to first page
      title: title || 'Unknown Title',
      author: author || 'Unknown Author',
      fiction: isNonFiction !== undefined ? !isNonFiction : true, // Use provided value or default to fiction
      first_page: firstAndSecondPages.first_page,
      second_page: firstAndSecondPages.second_page
    };
    
    // Still try to save the fallback result
    const metadataFilePath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'content_analysis.json');
    try {
      await fs.promises.writeFile(metadataFilePath, JSON.stringify(fallbackResult, null, 2));
      console.log(`Fallback content analysis saved to ${metadataFilePath}`);
    } catch (fileError) {
      console.error('Error saving fallback content analysis file:', fileError);
    }
    
    return fallbackResult;
  }
}

/**
 * Get the first and second pages of book content in a clean format
 * @param ocrResultsPath Path to the OCR results JSON file
 * @param title Book title if known
 * @param author Book author if known
 * @returns Object with first_page and second_page content
 */
export async function getFirstAndSecondContentPages(
  ocrResultsPath: string,
  title?: string,
  author?: string,
  isNonFiction?: boolean
): Promise<SimpleContentResult> {
  try {
    // Read OCR results from the file
    const ocrResults = await readOCRResultsFromFile(ocrResultsPath);
    
    // Use a unique ID based on the filename
    const bookId = path.basename(ocrResultsPath, path.extname(ocrResultsPath));
    
    // Prepare all pages content for GPT-4o
    const pagesContent = ocrResults.map((result, index) => {
      return {
        pageNumber: result.pageNumber,
        text: result.text.trim()
      };
    });
    
    // Use GPT-4o to directly get the cleaned first and second content pages
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert in book analysis and content extraction. Your task is to analyze OCR results from book pages, identify the first actual content page (after front matter like title page, copyright, TOC), and extract clean readable text for that page and the following page.

Remove all OCR artifacts, brackets, page numbers, and formatting noise. Present the text as it would appear in the actual book, with proper flow and readability.

An example of an index of the ocr results is:
{
    "index": n,
    "filename": "",
    "pageNumber": "#",
    "side": "left", (or right)
    "text": "",
    "confidence": #,
    "imagePath": ""
  },

  Return the cleaned text part but make sure to NOT truncate any of the text content. No truncation at all, it should return the FULL text content (and remove the noise that occurs for the OCR process). The noise will be obvious. Make sure the content flows well and reads natural (or as expected from the author). 

  Make sure everything you retunr is a part of THAT specific page in THAT specific index. Don't include any other page information outside that page.

  As a reminder, "\n\n" does NOT indicate a new page. Everything within the " " is part of the page. 

For fiction books, the first content page is typically the beginning of Chapter 1 or the Prologue.
For non-fiction books, the first content page is the beginning of the Introduction or Chapter 1.`
        },
        {
          role: 'user',
          content: `I have OCR results from ${pagesContent.length} consecutive pages of a book${title ? ` titled "${title}"` : ''}${author ? ` by ${author}` : ''}.

Here are the OCR results:
${pagesContent.map(p => `--- Page ${p.pageNumber} ---\n${p.text.substring(0, 1000)}\n`).join('\n')}

Find the first actual content page (not front matter or TOC), clean up the OCR text to make it read naturally as it would in the book, and provide ONLY a JSON response with:
- title: The book title ${title ? ` (known to be "${title}")` : ''}
- author: The book author ${author ? ` (known to be "${author}")` : ''}
- fiction: ${typeof isNonFiction === 'boolean' ? (isNonFiction ? 'false' : 'true') : 'Whether this appears to be fiction (true) or non-fiction (false)'}
- first_page: The cleaned text of the first content page
- second_page: The cleaned text of the page after the first content page`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 2000
    });
    
    if (!response.choices[0].message.content) {
      throw new Error('Empty response from content extraction');
    }
    
    // Parse the response directly
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    return {
      title: title || "Unknown title",
      author: author || "Unknown author",
      fiction: typeof isNonFiction === 'boolean' ? !isNonFiction : true,
      first_page: "Error extracting content",
      second_page: "Error extracting content"
    };
  }
}

/**
 * Get the recommended start page based on content analysis and book type
 * @param analysisResult Content analysis result
 * @param isNonFiction Whether the book is non-fiction (from metadata)
 * @returns Recommended page number to start reading
 */
export function getRecommendedStartPage(analysisResult: ContentAnalysisResult, isNonFiction?: boolean): number {
  // If we have a definitive non-fiction classification, use it
  const bookIsNonFiction = isNonFiction !== undefined ? isNonFiction : analysisResult.isNonFiction;
  
  // For non-fiction, start at the first content page
  // For fiction, we typically want to start at the first content page or the page after (for chapter 1)
  if (bookIsNonFiction) {
    return analysisResult.firstContentPage;
  } else {
    // For fiction, see if there's a page after the first content page that might be chapter 1
    const firstContentPageIndex = analysisResult.pageInsights.findIndex(
      page => page.pageNumber === analysisResult.firstContentPage
    );
    
    if (firstContentPageIndex >= 0 && firstContentPageIndex < analysisResult.pageInsights.length - 1) {
      const nextPage = analysisResult.pageInsights[firstContentPageIndex + 1];
      // If next page contains "chapter" in the content type, prefer that
      if (nextPage.contentType.toLowerCase().includes('chapter')) {
        return nextPage.pageNumber;
      }
    }
    
    // Otherwise use the recommended page from the analysis
    return analysisResult.recommendedStartPage;
  }
}

/**
 * Command-line interface for the book analysis service
 */
if (require.main === module) {
  // This will only run if the script is called directly from the command line
  const filePath = process.argv[2];
  const title = process.argv[3];
  const author = process.argv[4];
  const isNonFiction = process.argv[5] === 'true';
  if (!filePath) {
    process.exit(1);
  }
  
  // Completely silence all console output
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;
  
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  
  getFirstAndSecondContentPages(filePath, title, author, isNonFiction)
    .then(result => {
      // Restore console.log just for the output and print only the JSON
      console.log = originalConsoleLog;
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch(error => {
      process.exit(1);
    });
}