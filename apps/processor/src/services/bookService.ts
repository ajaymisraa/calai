import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
import cheerio from 'cheerio';
import * as bookImageCache from './bookImageCache';
import * as bookAnalysis from './bookAnalysisService';
import * as googleBooksService from './googleBooksService';
import path from 'path';
import { setTimeout } from 'timers/promises';
import { processPreviewImagesWithOCR, CombinedOCRResult } from '../utils/ocrUtils';
import { analyzeBookContent } from './bookAnalysisService';
import fs from 'fs';
import { addSilentLog, logMilestone } from '../utils/logUtils';

// Load environment variables
dotenv.config();

// Log API key status without exposing the key
console.log('OpenAI API Key status:', process.env.OPENAI_API_KEY ? 'Set' : 'Not set');
console.log('Google Books API Key status:', process.env.GOOGLE_BOOKS_API_KEY ? 'Set' : 'Not set');

// Initialize OpenAI with better error handling
let openai: OpenAI;
try {
  if (!process.env.OPENAI_API_KEY) {
    console.error('WARNING: OPENAI_API_KEY is not set in environment variables');
  }
  
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-initialization'
  });
  console.log('OpenAI client initialized successfully');
} catch (error) {
  console.error('Error initializing OpenAI client:', error);
  // Create a dummy client that will show clearer errors when methods are called
  openai = new OpenAI({
    apiKey: 'dummy-key-for-initialization'
  });
}

/**
 * Helper function to fetch an image from a URL and convert to data URI format
 * @param imageUrl URL of the image to fetch
 * @returns Object containing the data URI and content type
 */
async function fetchImageAsDataURI(imageUrl: string): Promise<{ dataURI: string; contentType: string }> {
  console.log('Fetching image from URL:', imageUrl);
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'image/*',
        'User-Agent': 'BookAnalysisService/1.0'
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log('Image fetched successfully, size:', response.data.length, 'bytes');
    
    const contentType = response.headers['content-type'];
    const imageBase64 = Buffer.from(response.data).toString('base64');
    const dataURI = `data:${contentType};base64,${imageBase64}`;
    
    return { dataURI, contentType };
  } catch (axiosError) {
    console.error('Error fetching or processing image:', axiosError);
    
    // Provide more detailed error information
    if (axios.isAxiosError(axiosError)) {
      const statusCode = axiosError.response?.status;
      
      if (statusCode === 404) {
        throw new Error('Image URL not found. Please check the URL and try again.');
      } else if (statusCode === 403) {
        throw new Error('Access to image URL forbidden. The image may be protected.');
      }
    }
    
    throw new Error(`Failed to fetch or process image: ${axiosError instanceof Error ? axiosError.message : 'Unknown error'}`);
  }
}

/**
 * Interface for book metadata
 */
export interface BookMetadata {
  isBook: boolean;
  title?: string;
  author?: string;
  isNonFiction?: boolean;
  confidence?: number;
}

/**
 * Interface for book content
 */
interface BookContent {
  metadata: BookMetadata;
  content?: string;
  pages?: string[];
  source?: string;
  previewImages?: string[]; // Array of paths to preview images
  coverImage?: string;     // Path to cover image
  sequentialPages?: {      // Sequential pages with OCR results
    imagePaths: string[];
    ocrResults: bookImageCache.OCRResult[];
  };
  previewOCRResults?: CombinedOCRResult; // Combined OCR results from preview images
  contentAnalysis?: bookAnalysis.ContentAnalysisResult; // Content analysis results
  recommendedStartPage?: number; // Recommended starting page
  googleBooksData?: {      // Google Books preview data
    id: string;
    previewLink?: string;
    webReaderLink?: string;
    embedLink?: string;
    viewability: 'NO_PAGES' | 'PARTIAL' | 'ALL_PAGES' | 'TEXTUAL';
    embeddable: boolean;
    extractedPreviewPages?: string[]; // Array of paths to extracted preview pages
  };
  error?: {               // Error information if something went wrong
    message: string;      // User-friendly error message
    code?: string;        // Error code for programmatic handling
  };
  isAvailable?: boolean;  // Flag indicating if the book content is available (false for NO_PAGES)
  status?: 'processing' | 'complete' | 'error'; // Status of the book processing
}

/**
 * Analyzes an image to determine if it contains a book and extracts metadata
 * @param imageUrl URL of the image to analyze
 * @returns Object containing book metadata including title, author and fiction/non-fiction status
 */
export const analyzeBookImage = async (imageUrl: string): Promise<BookMetadata> => {
  addSilentLog('=== BOOK IMAGE ANALYSIS STARTED ===');
  addSilentLog(`Analyzing image URL: ${imageUrl}`);
  
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OpenAI API key');
      addSilentLog('ERROR: Missing OpenAI API key');
      throw new Error('Missing OpenAI API key');
    }
    
    // First, download the image ourselves instead of letting OpenAI fetch it directly
    addSilentLog('Downloading image to create data URI...');
    let imageData: string;
    
    try {
      // Use our helper function to fetch the image as data URI
      const { dataURI } = await fetchImageAsDataURI(imageUrl);
      imageData = dataURI;
      addSilentLog('Image successfully downloaded and converted to data URI');
    } catch (fetchError) {
      addSilentLog(`Error fetching image: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      throw new Error(`Failed to download image: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
    }
    
    // Use OpenAI's Vision model to analyze the image and determine if it's a book cover
    addSilentLog('Initiating OpenAI vision analysis...');
    
    const result = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a book cover analyzer. Your task is to analyze an image to determine if it contains a book cover, and if so, extract the book's metadata.

Please provide your analysis in JSON format with the following fields:
- isBook: (boolean) Whether the image appears to contain a book
- title: (string) The title of the book if visible, or "unknown" if not clear
- author: (string) The author's name if visible, or "unknown" if not clear
- isNonFiction: (boolean) Your best guess if this is fiction (false) or non-fiction (true)
- confidence: (number) Your confidence in your analysis (0.0-1.0)
- reason: (string) Brief explanation of your reasoning`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image and determine if it contains a book cover. Provide the result in JSON format.' },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500
    });
    
    addSilentLog(`OpenAI analysis complete. Response status: ${result.choices.length > 0 ? 'Success' : 'No choices returned'}`);
    
    if (!result.choices[0].message.content) {
      addSilentLog('ERROR: Empty response from OpenAI');
      throw new Error('Empty response from book cover analysis');
    }
    
    // Parse the response
    const parsedResponse = JSON.parse(result.choices[0].message.content);
    
    // Extract title, author, and fiction/non-fiction status
    const title = typeof parsedResponse.title === 'string' ? parsedResponse.title.trim() : 'Unknown Title';
    const author = typeof parsedResponse.author === 'string' ? parsedResponse.author.trim() : 'Unknown Author';
    const isNonFiction = Boolean(parsedResponse.isNonFiction);
    
    // Output for logging
    console.log('Book detected:', { title, author, isNonFiction });
    
    // Log the result
    addSilentLog(`Book detection result: isBook=${parsedResponse.isBook}, title="${title}", author="${author}", isNonFiction=${isNonFiction}`);
    if (parsedResponse.reason) {
      addSilentLog(`Detection reasoning: ${parsedResponse.reason}`);
    }
    addSilentLog('=== BOOK IMAGE ANALYSIS COMPLETE ===');
    
    return {
      isBook: Boolean(parsedResponse.isBook),
      title,
      author,
      isNonFiction,
      confidence: typeof parsedResponse.confidence === 'number' ? parsedResponse.confidence : 0.5
    };
  } catch (error) {
    // Log error details
    addSilentLog('=== ERROR IN BOOK IMAGE ANALYSIS ===');
    addSilentLog(`Error message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      addSilentLog(`Stack trace: ${error.stack}`);
    }
    
    console.error('Error analyzing book image:', error);
    
    // Handle OpenAI API errors specifically
    if (error instanceof OpenAI.APIError) {
      addSilentLog(`OpenAI API error: Status=${error.status}, Type=${error.type}`);
      console.error('OpenAI API error:', {
        status: error.status,
        message: error.message,
        type: error.type
      });
      
      // Handle rate limiting
      if (error.status === 429) {
        addSilentLog('RATE LIMIT: OpenAI API rate limit exceeded');
        throw new Error('OpenAI API rate limit exceeded. Please try again later.');
      }
    }
    
    addSilentLog('=== END ERROR DETAILS ===');
    throw error;
  }
};

/**
 * Searches Google Books API for a book by title and author
 * @param title Book title
 * @param author Book author
 * @returns Book data if found, null otherwise
 */
async function searchGoogleBooks(title: string, author: string): Promise<any | null> {
  try {
    // Format query for Google Books API search using special keywords for better results
    const searchQuery = `intitle:"${title}" inauthor:"${author}"`;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : '';
    
    // Add additional parameters for better results:
    // - maxResults=5: Limit to 5 results to keep response size manageable
    // - printType=books: Only return books (not magazines)
    // - projection=full: Get complete volume information
    const searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}${apiKey}&maxResults=5&printType=books&projection=full`;
    
    console.log(`Searching Google Books for: "${title}" by ${author}`);
    console.log(`Search URL: ${searchUrl}`);
    
    // Fetch search results
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'BookAnalysisService/1.0 (educational purposes)'
      },
      timeout: 15000
    });
    
    // Check if we have results
    if (!response.data || !response.data.items || response.data.items.length === 0) {
      console.log('No matching books found on Google Books');
      return null;
    }
    
    // Get the first result that has text content available
    for (const book of response.data.items) {
      if (book.volumeInfo && 
          book.accessInfo && 
          (book.accessInfo.viewability === 'PARTIAL' || 
           book.accessInfo.viewability === 'ALL_PAGES' || 
           book.accessInfo.textToSpeechPermission === 'ALLOWED' ||
           book.accessInfo.epub?.isAvailable || 
           book.accessInfo.pdf?.isAvailable)) {
        
        console.log(`Found matching book with preview content: ${book.volumeInfo.title} by ${book.volumeInfo.authors?.join(', ')}`);
        return book;
      }
    }
    
    // If no book with available content is found, return the first result
    if (response.data.items[0]) {
      console.log(`Found book but limited content available: ${response.data.items[0].volumeInfo.title}`);
      return response.data.items[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error searching Google Books:', error);
      return null;
  }
}

/**
 * Extracts book information and preview content from Google Books API result
 * @param bookData The book data from Google Books API
 * @returns Array of text snippets from the book
 */
async function extractGoogleBookContent(bookData: any): Promise<string[]> {
  try {
    if (!bookData || !bookData.volumeInfo) {
      return [];
    }
    
    const bookId = bookData.id;
    const title = bookData.volumeInfo.title;
    console.log(`Extracting content for book: ${title} (ID: ${bookId})`);
    
    // Check if there's a text snippet in the search result
    const snippets: string[] = [];
    
    // Add the title and authors first
    const titleAndAuthor = `Title: ${title}${bookData.volumeInfo.subtitle ? ` - ${bookData.volumeInfo.subtitle}` : ''}`;
    snippets.push(titleAndAuthor);
    
    if (bookData.volumeInfo.authors && bookData.volumeInfo.authors.length > 0) {
      snippets.push(`Author(s): ${bookData.volumeInfo.authors.join(', ')}`);
    }
    
    // Add description if available
    if (bookData.volumeInfo.description) {
      snippets.push(`Book Description: ${bookData.volumeInfo.description}`);
    }
    
    // Add text snippet if available
    if (bookData.searchInfo && bookData.searchInfo.textSnippet) {
      const textSnippet = bookData.searchInfo.textSnippet
        .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      
      snippets.push(`Text Preview: ${textSnippet}`);
    }
    
    // Add information about the book's availability
    const availability = [];
    
    if (bookData.accessInfo) {
      const accessInfo = bookData.accessInfo;
      
      if (accessInfo.viewability) {
        let viewabilityText = 'Unknown';
        
        switch (accessInfo.viewability) {
          case 'PARTIAL':
            viewabilityText = 'Partial preview available';
            break;
          case 'ALL_PAGES':
            viewabilityText = 'Full view available';
            break;
          case 'NO_PAGES':
            viewabilityText = 'No preview available';
            break;
          case 'TEXTUAL':
            viewabilityText = 'Text-only preview available';
            break;
        }
        
        availability.push(viewabilityText);
      }
      
      if (accessInfo.epub?.isAvailable) {
        availability.push('Available as EPUB');
      }
      
      if (accessInfo.pdf?.isAvailable) {
        availability.push('Available as PDF');
      }
      
      if (accessInfo.webReaderLink) {
        snippets.push(`Preview Link: ${accessInfo.webReaderLink}`);
      }
    }
    
    if (availability.length > 0) {
      snippets.push(`Availability: ${availability.join(', ')}`);
    }
    
    // Try to get more detailed content if available
    if (bookData.volumeInfo.tableOfContents) {
      snippets.push(`Table of Contents: ${bookData.volumeInfo.tableOfContents}`);
    }
    
    // Add additional information about the book
    const bookInfo = [];
    
    if (bookData.volumeInfo.publisher) {
      bookInfo.push(`Publisher: ${bookData.volumeInfo.publisher}`);
    }
    
    if (bookData.volumeInfo.publishedDate) {
      bookInfo.push(`Published Date: ${bookData.volumeInfo.publishedDate}`);
    }
    
    if (bookData.volumeInfo.pageCount) {
      bookInfo.push(`Page Count: ${bookData.volumeInfo.pageCount}`);
    }
    
    if (bookData.volumeInfo.printType) {
      bookInfo.push(`Print Type: ${bookData.volumeInfo.printType}`);
    }
    
    if (bookData.volumeInfo.categories && bookData.volumeInfo.categories.length > 0) {
      bookInfo.push(`Categories: ${bookData.volumeInfo.categories.join(', ')}`);
    }
    
    if (bookData.volumeInfo.averageRating) {
      bookInfo.push(`Rating: ${bookData.volumeInfo.averageRating}/5 (${bookData.volumeInfo.ratingsCount || 0} ratings)`);
    }
    
    if (bookData.volumeInfo.industryIdentifiers && bookData.volumeInfo.industryIdentifiers.length > 0) {
      const isbns = bookData.volumeInfo.industryIdentifiers
        .map((id: any) => `${id.type}: ${id.identifier}`)
        .join(', ');
      bookInfo.push(`Identifiers: ${isbns}`);
    }
    
    if (bookInfo.length > 0) {
      snippets.push(`Book Information:\n${bookInfo.join('\n')}`);
    }
    
    // Add links to buy or view more if available
    if (bookData.saleInfo && bookData.saleInfo.buyLink) {
      snippets.push(`Buy Link: ${bookData.saleInfo.buyLink}`);
    }
    
    if (bookData.volumeInfo.infoLink) {
      snippets.push(`More Information: ${bookData.volumeInfo.infoLink}`);
    }
    
    // If we still don't have much content, add a note
    if (snippets.length <= 3) { // Only title, author, and maybe one more item
      snippets.push(`Limited preview available for "${title}". For full content, consider checking your local library or purchasing the book.`);
    }
    
    console.log(`Extracted ${snippets.length} content snippets for book`);
    return snippets;
  } catch (error) {
    console.error('Error extracting Google Books content:', error);
    return [];
  }
}

/**
 * Gets preview images for a book, renders them as PNGs, and caches them
 * @param bookData Book data from Google Books API
 * @returns Array of paths to cached preview images
 */
async function getAndCacheBookPreviewImages(bookData: any): Promise<string[]> {
  if (!bookData || !bookData.id) {
    console.log('Invalid book data provided to getAndCacheBookPreviewImages');
    return [];
  }

  const bookId = bookData.id;
  const imagePaths: string[] = [];
  
  try {
    console.log(`Generating preview images for book: ${bookId}`);
    
    // First, check if volumeInfo exists
    if (!bookData.volumeInfo) {
      console.log(`Book ${bookId} is missing volumeInfo, using limited metadata`);
      bookData.volumeInfo = {}; // Create empty object to prevent further errors
    }
    
    // Now try to get and cache the book cover image
    if (bookData.volumeInfo?.imageLinks) {
      // Try to get the largest available image
      const imageUrl = bookData.volumeInfo.imageLinks.extraLarge || 
                      bookData.volumeInfo.imageLinks.large || 
                      bookData.volumeInfo.imageLinks.medium || 
                      bookData.volumeInfo.imageLinks.small || 
                      bookData.volumeInfo.imageLinks.thumbnail;
      
      if (imageUrl) {
        try {
          const coverPath = await bookImageCache.cacheBookCoverImage(bookId, imageUrl);
          imagePaths.push(coverPath);
          console.log(`Cached cover image for book ${bookId}`);
        } catch (error) {
          console.error('Error caching cover image:', error);
        }
      }
    }
    
    // If there are any preview pages extracted from the Google Books preview, include them
    if (bookData.extractedPreviewPages && bookData.extractedPreviewPages.length > 0) {
      console.log(`Adding ${bookData.extractedPreviewPages.length} extracted preview pages`);
      // Convert absolute paths to relative paths
      const relativePaths = bookData.extractedPreviewPages.map((p: string) => 
        path.relative(process.cwd(), p)
      );
      imagePaths.push(...relativePaths);
    }
    
    // Extract basic metadata
    const { title, subtitle, authors = [], publisher, publishedDate, description } = bookData.volumeInfo;
    
    // Render title, author, and publisher info as an image
    const bookInfo = [
      `Title: ${title}${subtitle ? ` - ${subtitle}` : ''}`,
      `Author(s): ${authors.join(', ')}`,
      publisher ? `Publisher: ${publisher}` : '',
      publishedDate ? `Published: ${publishedDate}` : '',
      description ? `\nDescription: ${description}` : ''
    ].filter(Boolean).join('\n');
    
    const infoImagePath = await bookImageCache.renderTextToImage(
      bookId,
      'info',
      bookInfo,
      'Book Information'
    );
    imagePaths.push(infoImagePath);
    
    // Generate preview pages if text snippets are available
    if (bookData.searchInfo?.textSnippet) {
      const textSnippet = bookData.searchInfo.textSnippet
        .replace(/<\/?[^>]+(>|$)/g, '') // Remove HTML tags
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      
      const previewImagePath = await bookImageCache.renderTextToImage(
        bookId,
        'preview1',
        textSnippet,
        'Preview Text'
      );
      imagePaths.push(previewImagePath);
    }
    
    // If we have table of contents, render it as a page
    if (bookData.volumeInfo?.tableOfContents) {
      const tocImagePath = await bookImageCache.renderTextToImage(
        bookId,
        'toc',
        bookData.volumeInfo.tableOfContents,
        'Table of Contents'
      );
      imagePaths.push(tocImagePath);
    }
    
    console.log(`Generated ${imagePaths.length} preview images for book ${bookId}`);
    
    // First: Clean up old cached images to save disk space
    console.log(`First step: cleaning up cache for book ${bookId}`);
    await bookImageCache.cleanupCache();
    
    // Second: Run OCR after all cleaning is done
    console.log(`Second step: performing OCR for book ${bookId}`);
    await bookImageCache.ensurePreviewImagesOCR(bookId);
    
    return imagePaths;
  } catch (error) {
    console.error('Error generating preview images:', error);
    return imagePaths;
  }
}

/**
 * Combines text content from Google Books and generates sequential pages with OCR
 * @param bookId Book ID
 * @param textContent Array of text content segments
 * @returns Sequential pages with OCR results
 */
async function generateAndOCRSequentialPages(
  bookId: string,
  textContent: string[],
  title?: string,
  author?: string
): Promise<{
  sequentialPages: {
    imagePaths: string[];
    ocrResults: bookImageCache.OCRResult[];
  };
  contentAnalysis: bookAnalysis.ContentAnalysisResult;
  recommendedStartPage: number;
}> {
  console.log(`Generating sequential pages and OCR for book: ${title || bookId}`);
  
  // Combine all text content into a single string for sequential processing
  const fullContent = textContent.join('\n\n');
  
  // Generate sequential pages and perform OCR
  const { imagePaths, ocrResults } = await bookImageCache.generateSequentialPages(
    bookId,
    fullContent,
    5, // Generate 5 pages
    1   // Start with page 1
  );
  
  console.log(`Generated ${imagePaths.length} sequential pages with OCR for book ${bookId}`);
  
  // Analyze content to find the first content page and determine fiction/non-fiction
  const contentAnalysis = await bookAnalysis.analyzeBookContent(
    bookId,
    ocrResults,
    title,
    author
  );
  
  // Determine recommended start page based on book type
  const recommendedStartPage = bookAnalysis.getRecommendedStartPage(
    contentAnalysis
  );
  
  return {
    sequentialPages: { imagePaths, ocrResults },
    contentAnalysis,
    recommendedStartPage
  };
}

/**
 * Gets Google Books preview information for a book
 * @param title Book title
 * @param author Book author
 * @returns Google Books preview data
 */
async function getGoogleBooksPreview(title: string, author: string): Promise<BookContent['googleBooksData'] | undefined> {
  try {
    // Search for the book in Google Books API
    const bookData = await googleBooksService.searchGoogleBooks(title, author);
    
    if (!bookData) {
      console.log(`No book found in Google Books for: ${title} by ${author}`);
      return undefined;
    }
    
    // Determine if the book has a preview available
    const hasPreview = bookData.accessInfo.viewability === 'PARTIAL' || 
                       bookData.accessInfo.viewability === 'ALL_PAGES';
    
    if (!hasPreview) {
      console.log(`No preview available for: ${title} by ${author}`);
    } else {
      console.log(`Preview available for: ${title} by ${author}`);
      console.log(`Attempting to extract pages from preview: ${bookData.accessInfo.webReaderLink}`);
    }
    
    // Determine if the book is fiction or non-fiction
    const isNonFiction = googleBooksService.determineNonFiction(bookData);
    
    // Create embed link for the preview
    const embedLink = googleBooksService.getEmbedPreviewUrl(bookData.id);
    
    let extractedPreviewPages: string[] = [];
    let cachedPreviewPaths: string[] = [];
    
    if (hasPreview && bookData.accessInfo.webReaderLink) {
      try {
        // Skip text extraction and go straight to grabbing screenshots
        console.log('Starting to extract preview pages using direct URL navigation...');
        extractedPreviewPages = await googleBooksService.extractPreviewPagesFromGoogleBooks(
          bookData.id, 
          bookData.accessInfo.webReaderLink
        );
        
        if (extractedPreviewPages && extractedPreviewPages.length > 0) {
          console.log(`Successfully extracted ${extractedPreviewPages.length} preview pages!`);
          
          // Cache these pages as images
          cachedPreviewPaths = [];
          for (let i = 0; i < extractedPreviewPages.length; i++) {
            try {
              console.log(`Caching preview page ${i + 1}/${extractedPreviewPages.length}...`);
              // Generate a meaningful name that includes page number
              const pageName = `preview_page_${String(i + 1).padStart(2, '0')}`;
              
              const pagePath = await bookImageCache.cacheDataURIAsImage(
                bookData.id,
                pageName,
                extractedPreviewPages[i]
              );
              console.log(`Cached preview page ${i + 1} at: ${pagePath}`);
              cachedPreviewPaths.push(pagePath);
            } catch (err) {
              console.error(`Error caching preview page ${i + 1}:`, err);
            }
          }
          
          console.log(`Successfully cached ${cachedPreviewPaths.length} preview pages`);
        } else {
          console.log('No preview pages were extracted - the preview may be restricted');
        }
      } catch (previewError) {
        console.error('Error extracting book preview content:', previewError);
      }
    }
    
    // Return preview data
    return {
      id: bookData.id,
      previewLink: bookData.volumeInfo.previewLink,
      webReaderLink: bookData.accessInfo.webReaderLink,
      embedLink,
      viewability: bookData.accessInfo.viewability,
      embeddable: bookData.accessInfo.embeddable,
      extractedPreviewPages: cachedPreviewPaths.length > 0 ? cachedPreviewPaths : undefined
    };
  } catch (error) {
    console.error('Error getting Google Books preview:', error);
    return undefined;
  }
}

/**
 * Process all preview images for a book with OCR in chronological order
 * @param bookId Book ID
 * @param previewImages Array of image paths
 * @returns OCR results from all preview images
 */
async function processPreviewImagesChronologically(bookId: string, previewImages: string[]): Promise<CombinedOCRResult | undefined> {
  if (!previewImages || previewImages.length === 0) {
    console.log('No preview images to process');
    return undefined;
  }
  
  try {
    // Get the directory containing the preview images
    // Since all images should be in the same directory, we can extract it from the first image path
    const firstImagePath = previewImages[0];
    const bookCacheDir = path.dirname(firstImagePath);
    
    console.log(`Processing ${previewImages.length} preview images chronologically for book ${bookId}`);
    
    // Check if all images exist before proceeding
    const missingImages = previewImages.filter(imgPath => !fs.existsSync(imgPath));
    if (missingImages.length > 0) {
      console.error(`Missing ${missingImages.length} images. Waiting for them to be saved...`);
      // Wait a moment for any file operations to complete
      await setTimeout(2000);
      
      // Check again
      const stillMissing = missingImages.filter(imgPath => !fs.existsSync(imgPath));
      if (stillMissing.length > 0) {
        console.error(`Still missing ${stillMissing.length} images after waiting. Cannot proceed with OCR.`);
        return undefined;
      }
    }
    
    // Ensure the directory exists
    if (!fs.existsSync(bookCacheDir)) {
      console.error(`Book cache directory does not exist: ${bookCacheDir}`);
      return undefined;
    }
    
    // Check for the expected naming pattern before processing
    const files = fs.readdirSync(bookCacheDir);
    const previewPagePattern = /^preview_page_\d+_(left|right)\.(jpg|png)$/;
    const matchingFiles = files.filter(file => previewPagePattern.test(file));
    
    if (matchingFiles.length === 0) {
      console.error(`No files match the expected 'preview_page_XX_[left|right].[jpg|png]' pattern in ${bookCacheDir}`);
      return undefined;
    }
    
    console.log(`Found ${matchingFiles.length} files matching the expected pattern`);
    
    // Use our utility function to process the images in chronological order
    // This will also save the results to a JSON file with sequential indexing
    const ocrResults = await processPreviewImagesWithOCR(bookCacheDir);
    
    // Check if the JSON file was created
    const jsonFilePath = path.join(bookCacheDir, 'ocr_results.json');
    if (fs.existsSync(jsonFilePath)) {
      console.log(`OCR results JSON file created successfully at ${jsonFilePath}`);
      
      // Verify JSON content
      try {
        const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
        const parsedJson = JSON.parse(jsonContent);
        console.log(`JSON file contains data for ${parsedJson.length} images`);
      } catch (jsonError) {
        console.error('Error verifying JSON file:', jsonError);
      }
    } else {
      console.error(`JSON file was not created at ${jsonFilePath}`);
    }
    
    console.log(`Processed ${ocrResults.pages.length} pages with average confidence ${ocrResults.averageConfidence.toFixed(2)}%`);
    
    return ocrResults;
  } catch (error) {
    console.error('Error processing preview images chronologically:', error);
    return undefined;
  }
}

/**
 * Read metadata from id_mapping.json file if it exists
 * @param bookId The book ID to look up
 * @returns The metadata from the mapping file, or undefined if not found
 */
async function getMetadataFromMapping(bookId: string): Promise<BookMetadata | undefined> {
  try {
    const mappingPath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'id_mapping.json');
    
    if (fs.existsSync(mappingPath)) {
      console.log(`Reading metadata from existing mapping file: ${mappingPath}`);
      const mappingContent = fs.readFileSync(mappingPath, 'utf8');
      const mapping = JSON.parse(mappingContent);
      
      // Check if originalMetadata exists in the mapping
      if (mapping.originalMetadata) {
        console.log(`Found metadata in mapping: title="${mapping.originalMetadata.title}", author="${mapping.originalMetadata.author}", isNonFiction=${mapping.originalMetadata.isNonFiction}`);
        return mapping.originalMetadata as BookMetadata;
      }
      
      // If we have a link to another ID, try to get metadata from there
      if (mapping.originalId && mapping.originalId !== bookId) {
        console.log(`Found link to original ID: ${mapping.originalId}, checking its mapping`);
        return getMetadataFromMapping(mapping.originalId);
      }
      
      if (mapping.googleBooksId && mapping.googleBooksId !== bookId) {
        console.log(`Found link to Google Books ID: ${mapping.googleBooksId}, checking its mapping`);
        return getMetadataFromMapping(mapping.googleBooksId);
      }
    }
    
    return undefined;
  } catch (error) {
    console.error('Error reading metadata from mapping:', error);
    return undefined;
  }
}

/**
 * Ensure content_analysis.json has the correct metadata from id_mapping.json
 * @param bookId The book ID to use for file paths
 * @param originalMetadata The original metadata to use if mapping doesn't exist
 */
async function ensureContentAnalysisMetadata(bookId: string, originalMetadata: BookMetadata): Promise<void> {
  try {
    const contentAnalysisPath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'content_analysis.json');
    const ocrResultsPath = path.join(process.cwd(), 'cache', 'book-images', bookId, 'ocr_results.json');
    
    // CRITICAL CHANGE: Check if ocr_results.json exists
    if (!fs.existsSync(ocrResultsPath)) {
      console.log(`OCR results file not found at ${ocrResultsPath}. Cannot update content_analysis.json without OCR results.`);
      return;
    }
    
    // First check if we have mapping metadata
    const mappingMetadata = await getMetadataFromMapping(bookId);
    const metadataToUse = mappingMetadata || originalMetadata;
    
    let existingAnalysis = {};
    let needsContentCleanup = false;
    
    // If content_analysis.json exists, read it
    if (fs.existsSync(contentAnalysisPath)) {
      console.log(`Reading existing content analysis file: ${contentAnalysisPath}`);
      try {
        const content = fs.readFileSync(contentAnalysisPath, 'utf8');
        existingAnalysis = JSON.parse(content);
        console.log(`Existing content analysis: ${JSON.stringify(existingAnalysis, null, 2).substring(0, 200)}...`);
        
        // Check if we need to clean up content pages
        const analysis = existingAnalysis as any;
        if (!analysis.first_page || 
            !analysis.second_page || 
            analysis.first_page.length < 50 ||
            analysis.second_page.length < 50 ||
            analysis.first_page.includes("Error extracting content") ||
            analysis.second_page.includes("Error extracting content")) {
          needsContentCleanup = true;
          console.log('Content analysis exists but needs content pages cleanup');
        }
      } catch (readError) {
        console.error('Error reading content analysis file:', readError);
      }
    }
    
    // Create or update the content analysis with correct metadata
    const updatedAnalysis = {
      ...existingAnalysis,
      title: metadataToUse.title,
      author: metadataToUse.author,
      fiction: !metadataToUse.isNonFiction,
      isNonFiction: metadataToUse.isNonFiction
    };
    
    // Save the updated analysis
    console.log(`Saving updated content analysis with metadata - title="${updatedAnalysis.title}", author="${updatedAnalysis.author}", fiction=${updatedAnalysis.fiction}, isNonFiction=${updatedAnalysis.isNonFiction}`);
    fs.writeFileSync(contentAnalysisPath, JSON.stringify(updatedAnalysis, null, 2));
    console.log(`Successfully updated content analysis file at ${contentAnalysisPath}`);
    
    // Also update any other copies of the content analysis for redundancy
    if (mappingMetadata) {
      // If we found metadata in a mapping file, make sure both original and Google Books IDs have the content analysis
      const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'cache', 'book-images', bookId, 'id_mapping.json'), 'utf8'));
      
      if (mapping.originalId && mapping.originalId !== bookId) {
        const originalOcrPath = path.join(process.cwd(), 'cache', 'book-images', mapping.originalId, 'ocr_results.json');
        // CRITICAL CHANGE: Only update content analysis if OCR results exist
        if (fs.existsSync(originalOcrPath)) {
          const originalAnalysisPath = path.join(process.cwd(), 'cache', 'book-images', mapping.originalId, 'content_analysis.json');
          console.log(`Updating content analysis for original ID ${mapping.originalId}`);
          fs.mkdirSync(path.dirname(originalAnalysisPath), { recursive: true });
          fs.writeFileSync(originalAnalysisPath, JSON.stringify(updatedAnalysis, null, 2));
        } else {
          console.log(`Skipping content analysis update for original ID ${mapping.originalId} - no OCR results file`);
        }
      }
      
      if (mapping.googleBooksId && mapping.googleBooksId !== bookId) {
        const googleOcrPath = path.join(process.cwd(), 'cache', 'book-images', mapping.googleBooksId, 'ocr_results.json');
        // CRITICAL CHANGE: Only update content analysis if OCR results exist
        if (fs.existsSync(googleOcrPath)) {
          const googleAnalysisPath = path.join(process.cwd(), 'cache', 'book-images', mapping.googleBooksId, 'content_analysis.json');
          console.log(`Updating content analysis for Google Books ID ${mapping.googleBooksId}`);
          fs.mkdirSync(path.dirname(googleAnalysisPath), { recursive: true });
          fs.writeFileSync(googleAnalysisPath, JSON.stringify(updatedAnalysis, null, 2));
        } else {
          console.log(`Skipping content analysis update for Google Books ID ${mapping.googleBooksId} - no OCR results file`);
        }
      }
    }
    
    // If we need to clean up content pages and there's an OCR file available, do it now
    if (needsContentCleanup) {
      console.log(`OCR file exists for ${bookId}, attempting to clean book content pages`);
      try {
        await cleanBookContentPages(bookId);
        console.log(`Successfully cleaned book content pages for ${bookId}`);
      } catch (cleanupError) {
        console.error('Error cleaning book content pages during metadata update:', cleanupError);
      }
    }
  } catch (error) {
    console.error('Error ensuring content analysis metadata:', error);
  }
}

/**
 * Gets content for a book using Google Books and other sources
 * @param imageUrl URL of the book image to analyze
 * @param existingMetadata Optional existing book metadata to avoid duplicate analysis
 * @returns Object containing book metadata and content if available
 */
export const getBookContent = async (imageUrl: string, existingMetadata?: BookMetadata, originalBookId?: string): Promise<BookContent> => {
  addSilentLog('=== BOOK CONTENT PROCESSING STARTED ===');
  addSilentLog(`Image URL: ${imageUrl}`);
  addSilentLog(`Original Book ID: ${originalBookId || 'Not provided'}`);
  if (existingMetadata) {
    addSilentLog(`Existing Metadata: ${JSON.stringify(existingMetadata, null, 2)}`);
  }
  
  try {
    // Step 1: Use existing metadata if provided, otherwise analyze the image
    const bookMetadata = existingMetadata || await analyzeBookImage(imageUrl);
    
    // Store original metadata in a separate object to ensure it's never lost
    const originalMetadata = {
      isBook: bookMetadata.isBook,
      title: bookMetadata.title || 'Unknown Title',
      author: bookMetadata.author || 'Unknown Author',
      isNonFiction: bookMetadata.isNonFiction !== undefined ? bookMetadata.isNonFiction : false,
      confidence: bookMetadata.confidence || 0.5
    };
    
    console.log(`Book metadata analysis complete: ${originalMetadata.title} by ${originalMetadata.author}, isBook: ${originalMetadata.isBook}, isNonFiction: ${originalMetadata.isNonFiction}`);
    
    // Initialize with default values and ensure metadata is set from the start
    const content: BookContent = {
      metadata: originalMetadata,
      previewImages: [],
      isAvailable: true,  // Default to true, will be set to false if book is not available
      status: 'processing' // Default status is processing
    };
    
    // If not a book, return early with just metadata
    if (!originalMetadata.isBook) {
      console.log('Not a book, returning just metadata');
      content.isAvailable = false;
      content.status = 'error';
      content.error = {
        message: 'The uploaded image does not appear to be a book cover.',
        code: 'NOT_A_BOOK'
      };
      return content;
    }
    
    // If we have title and author, try to get content from Google Books
    if (originalMetadata.title) {
      console.log(`Searching Google Books for: "${originalMetadata.title}" by ${originalMetadata.author || 'Unknown'}`);
      
      const googleBooksData = await getGoogleBooksPreview(
        originalMetadata.title,
        originalMetadata.author || ''
      );
      
      if (!googleBooksData) {
        console.log(`No Google Books data found for "${originalMetadata.title}" by ${originalMetadata.author}`);
        content.isAvailable = false;
        content.status = 'error';
        content.error = {
          message: `We couldn't find "${originalMetadata.title}" by ${originalMetadata.author} in our database.`,
          code: 'BOOK_NOT_FOUND'
        };
        
        logMilestone('BOOK_NOT_FOUND');
        addSilentLog(`Book not found: "${originalMetadata.title}" by ${originalMetadata.author}`);
        addSilentLog('=== BOOK CONTENT PROCESSING FINISHED EARLY (NOT FOUND) ===');
        
        return content;
      }
      
      console.log(`Google Books preview available: ${googleBooksData.viewability}`);
      
      // Check if the book has "NO_PAGES" viewability and return early with error message
      if (googleBooksData.viewability === 'NO_PAGES') {
        console.log(`Book has NO_PAGES viewability. Returning error to frontend.`);
        addSilentLog(`Book has NO_PAGES viewability. Returning error to frontend.`);
        
        // Set isAvailable flag to false
        content.isAvailable = false;
        
        // Set status to error - CRITICAL for frontend detection
        content.status = 'error';
        
        // Add error information to the response
        content.error = {
          message: `We couldn't find "${originalMetadata.title}" by ${originalMetadata.author} in our database.`,
          code: 'NO_PAGES_AVAILABLE'
        };
        
        // Still include Google Books data and metadata for reference
        content.googleBooksData = googleBooksData;
        
        // Save the error information to a file for the status API to read
        try {
          // Create book directory if it doesn't exist
          if (googleBooksData.id) {
            const bookDir = path.join(process.cwd(), 'cache', 'book-images', googleBooksData.id);
            if (!fs.existsSync(bookDir)) {
              fs.mkdirSync(bookDir, { recursive: true });
            }
            
            // Save error information
            const errorPath = path.join(bookDir, 'error.json');
            fs.writeFileSync(errorPath, JSON.stringify({
              message: `We couldn't find "${originalMetadata.title}" by ${originalMetadata.author} in our database.`,
              code: 'NO_PAGES_AVAILABLE',
              timestamp: new Date().toISOString()
            }, null, 2));
            
            // Save metadata as well
            const metadataPath = path.join(bookDir, 'metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify({
              title: originalMetadata.title,
              author: originalMetadata.author,
              isNonFiction: originalMetadata.isNonFiction,
              confidence: originalMetadata.confidence
            }, null, 2));
            
            // Also save google_books.json for reference
            const googleBooksPath = path.join(bookDir, 'google_books.json');
            fs.writeFileSync(googleBooksPath, JSON.stringify(googleBooksData, null, 2));
          }
          
          // If originalBookId is provided, save there too for cross-reference
          if (originalBookId) {
            const origBookDir = path.join(process.cwd(), 'cache', 'book-images', originalBookId);
            if (!fs.existsSync(origBookDir)) {
              fs.mkdirSync(origBookDir, { recursive: true });
            }
            
            // Save error information 
            const errorPath = path.join(origBookDir, 'error.json');
            fs.writeFileSync(errorPath, JSON.stringify({
              message: `We couldn't find "${originalMetadata.title}" by ${originalMetadata.author} in our database.`,
              code: 'NO_PAGES_AVAILABLE',
              timestamp: new Date().toISOString()
            }, null, 2));
            
            // Save ID mapping for cross-reference
            if (googleBooksData.id) {
              const mappingPath = path.join(origBookDir, 'id_mapping.json');
              fs.writeFileSync(mappingPath, JSON.stringify({
                googleBooksId: googleBooksData.id,
                uploadId: originalBookId
              }, null, 2));
            }
          }
        } catch (fsError) {
          console.error('Error saving error information to filesystem:', fsError);
        }
        
        // Log the early return
        logMilestone('BOOK_NOT_AVAILABLE');
        console.log(`Ending request early due to NO_PAGES viewability`);
        addSilentLog(`Ending request early due to NO_PAGES viewability`);
        addSilentLog('=== BOOK CONTENT PROCESSING FINISHED EARLY (NO_PAGES) ===');
        
        return content;
      }
      
      content.googleBooksData = googleBooksData;
      
      // Create ID mapping to link the original UUID with Google Books ID
      if (googleBooksData.id) {
        // Save a mapping in the original UUID directory
        const originalIdDir = path.join(process.cwd(), 'cache', 'book-images', originalBookId || '');
        if (!fs.existsSync(originalIdDir)) {
          fs.mkdirSync(originalIdDir, { recursive: true });
        }
        
        // Create a mapping file that links the original UUID to Google Books ID
        fs.writeFileSync(
          path.join(originalIdDir, 'id_mapping.json'),
          JSON.stringify({
            originalId: originalBookId || '',
            googleBooksId: googleBooksData.id,
            // Store the original metadata in the mapping file as well
            originalMetadata
          }, null, 2)
        );
        
        // Also create a mapping in the Google Books ID directory
        const googleIdDir = path.join(process.cwd(), 'cache', 'book-images', googleBooksData.id);
        if (!fs.existsSync(googleIdDir)) {
          fs.mkdirSync(googleIdDir, { recursive: true });
        }
        
        // Create a reverse mapping file in the Google Books ID directory
        fs.writeFileSync(
          path.join(googleIdDir, 'id_mapping.json'),
          JSON.stringify({
            originalId: originalBookId || '',
            googleBooksId: googleBooksData.id,
            // Store the original metadata in this mapping file too
            originalMetadata
          }, null, 2)
        );
        
        console.log(`Created ID mapping between ${originalBookId || ''} and ${googleBooksData.id} with original metadata`);
        
        // IMPORTANT: Immediately ensure content_analysis.json has the correct metadata
        // This handles the case where a content_analysis.json might already exist with incorrect metadata
        await ensureContentAnalysisMetadata(googleBooksData.id, originalMetadata);
        if (originalBookId) {
          await ensureContentAnalysisMetadata(originalBookId, originalMetadata);
        }
      }
      
      // Get any preview images
      const previewImages = await getAndCacheBookPreviewImages(googleBooksData);
      
      // Include any extracted preview pages in preview images
      if (googleBooksData.extractedPreviewPages && googleBooksData.extractedPreviewPages.length > 0) {
        // Only add unique paths that aren't already in previewImages
        const existingPaths = new Set(previewImages);
        for (const path of googleBooksData.extractedPreviewPages) {
          if (!existingPaths.has(path)) {
            previewImages.push(path);
          }
        }
        console.log(`Added ${googleBooksData.extractedPreviewPages.length} extracted preview pages to preview images`);
      }
      
      content.previewImages = previewImages;
      console.log(`Preview images generated: ${previewImages.length}`);
      
      // Get the cover image (first preview image or the one with "cover" in the name)
      const coverImagePath = previewImages.find(path => path.includes('cover'));
      if (coverImagePath) {
        content.coverImage = coverImagePath;
      } else if (previewImages.length > 0) {
        content.coverImage = previewImages[0];
      }

      // Clean up old cached images to save disk space first
      await bookImageCache.cleanupCache();

      // Process all preview images with OCR in chronological order AFTER cleanup
      if (previewImages.length > 0) {
        console.log('Processing preview images with OCR in chronological order (after cleanup)...');
        content.previewOCRResults = await processPreviewImagesChronologically(
          googleBooksData.id, 
          previewImages
        );
        
        if (content.previewOCRResults) {
          console.log(`OCR processing complete with ${content.previewOCRResults.pages.length} pages analyzed`);
          
          // If we don't have content from Google Books API, use the OCR text as the main content
          if (!content.pages || content.pages.length === 0) {
            content.pages = content.previewOCRResults.pages.map(page => 
              `${page.leftText} ${page.rightText}`.trim()
            );
            console.log(`Using OCR results as main content (${content.pages.length} pages)`);
          }

          // Use the existing OCR results for content analysis instead of doing it again
          try {
            console.log('Using existing OCR results for content analysis...');
            console.log('Passing original metadata to content analysis:', {
              title: originalMetadata.title,
              author: originalMetadata.author,
              isNonFiction: originalMetadata.isNonFiction
            });
            
            // Create a content_analysis.json file directly with the original metadata
            const metadataFilePath = path.join(process.cwd(), 'cache', 'book-images', googleBooksData.id, 'content_analysis.json');
            
            // First, check if we already have content_analysis.json with the correct metadata
            let existingAnalysis: any = null;
            if (fs.existsSync(metadataFilePath)) {
              try {
                const content = fs.readFileSync(metadataFilePath, 'utf8');
                existingAnalysis = JSON.parse(content);
                console.log(`Found existing content analysis: ${JSON.stringify(existingAnalysis, null, 2).substring(0, 200)}...`);
              } catch (readError) {
                console.error('Error reading existing content analysis:', readError);
              }
            }
            
            // If we have existing analysis, verify the metadata
            let skipRemainingAnalysis = false;
            if (existingAnalysis) {
              // Check if metadata matches
              const needsUpdate = existingAnalysis.title !== originalMetadata.title || 
                                 existingAnalysis.author !== originalMetadata.author || 
                                 existingAnalysis.fiction === originalMetadata.isNonFiction; // Inverted check
              
              if (needsUpdate) {
                console.log('Existing content analysis has incorrect metadata, updating...');
                // Update the metadata while preserving the rest of the analysis
                existingAnalysis.title = originalMetadata.title;
                existingAnalysis.author = originalMetadata.author;
                existingAnalysis.fiction = !originalMetadata.isNonFiction;
                existingAnalysis.isNonFiction = originalMetadata.isNonFiction;
                
                // Save the updated analysis
                fs.writeFileSync(metadataFilePath, JSON.stringify(existingAnalysis, null, 2));
                console.log(`Updated existing content analysis with correct metadata`);
                
                // Use this as our content analysis
                content.contentAnalysis = {
                  firstContentPage: existingAnalysis.first_page ? 1 : 0,
                  isNonFiction: originalMetadata.isNonFiction,
                  confidence: 0.9,
                  pageInsights: [],
                  recommendedStartPage: 1
                };
                
                // Add the extended fields as any to avoid TypeScript errors
                (content.contentAnalysis as any).title = originalMetadata.title;
                (content.contentAnalysis as any).author = originalMetadata.author;
                (content.contentAnalysis as any).fiction = !originalMetadata.isNonFiction;
                (content.contentAnalysis as any).first_page = existingAnalysis.first_page || '';
                (content.contentAnalysis as any).second_page = existingAnalysis.second_page || '';
                
                content.recommendedStartPage = 1;
                console.log('Used existing analysis with updated metadata');
                
                // Skip the rest of the analysis process
                console.log('Content analysis complete with updated metadata');
                console.log(`Final metadata in content analysis: title="${originalMetadata.title}", author="${originalMetadata.author}", isNonFiction=${originalMetadata.isNonFiction}`);
                
                // Set flag to skip remaining analysis
                skipRemainingAnalysis = true;
              } else {
                console.log('Existing content analysis has correct metadata, using as is');
                
                // Convert the analysis to our internal format
                content.contentAnalysis = {
                  firstContentPage: existingAnalysis.first_page ? 1 : 0,
                  isNonFiction: originalMetadata.isNonFiction,
                  confidence: 0.9,
                  pageInsights: [],
                  recommendedStartPage: 1
                };
                
                // Add the extended fields as any to avoid TypeScript errors
                (content.contentAnalysis as any).title = originalMetadata.title;
                (content.contentAnalysis as any).author = originalMetadata.author;
                (content.contentAnalysis as any).fiction = !originalMetadata.isNonFiction;
                (content.contentAnalysis as any).first_page = existingAnalysis.first_page || '';
                (content.contentAnalysis as any).second_page = existingAnalysis.second_page || '';
                
                content.recommendedStartPage = 1;
                console.log('Used existing analysis with correct metadata');
                
                // Skip the rest of the analysis process
                console.log('Content analysis complete with existing metadata');
                console.log(`Final metadata in content analysis: title="${originalMetadata.title}", author="${originalMetadata.author}", isNonFiction=${originalMetadata.isNonFiction}`);
                
                // Set flag to skip remaining analysis
                skipRemainingAnalysis = true;
              }
            }
            
            // Only proceed with analysis if we didn't skip it above
            if (!skipRemainingAnalysis) {
              // Check if OCR results exist before creating content_analysis.json
              const ocrResultsPath = path.join(process.cwd(), 'cache', 'book-images', googleBooksData.id, 'ocr_results.json');
              if (!fs.existsSync(ocrResultsPath)) {
                console.log(`OCR results file not found at ${ocrResultsPath}. Cannot create content_analysis.json without OCR results.`);
                return content;
              }
              
              // Prepare content analysis data with the original metadata
              const analysisData = {
                title: originalMetadata.title,
                author: originalMetadata.author,
                fiction: !originalMetadata.isNonFiction, // Convert isNonFiction to fiction
                first_page: '',
                second_page: ''
              };
              
              // Run the content analysis with our original metadata
              const contentAnalysis = await bookAnalysis.analyzeBookContent(
                googleBooksData.id,
                content.previewOCRResults.pages.map(page => ({
                  text: `${page.leftText} ${page.rightText}`.trim(),
                  confidence: (page.leftConfidence + page.rightConfidence) / 2,
                  imagePath: page.leftImagePath,
                  pageNumber: page.pageNumber
                })),
                originalMetadata.title,
                originalMetadata.author,
                originalMetadata.isNonFiction // Pass the original fiction status
              );
              
              // Merge the analysis data with the original metadata
              if (contentAnalysis) {
                analysisData.first_page = contentAnalysis.first_page || '';
                analysisData.second_page = contentAnalysis.second_page || '';
                
                // Save the analysis with our original metadata
                try {
                  fs.writeFile(metadataFilePath, JSON.stringify(analysisData, null, 2), (err) => {
                    if (err) {
                      console.error('Error saving content analysis file:', err);
                    } else {
                      console.log(`Book content analysis saved to ${metadataFilePath}`);
                      console.log(`Used original metadata - title: ${analysisData.title}, author: ${analysisData.author}, fiction: ${analysisData.fiction}`);
                    }
                  });
                } catch (fileError) {
                  console.error('Error saving content analysis file:', fileError);
                }
                
                // Store content analysis in our internal format
                content.contentAnalysis = {
                  firstContentPage: contentAnalysis.firstContentPage || 1,
                  isNonFiction: originalMetadata.isNonFiction,
                  confidence: contentAnalysis.confidence || 0.5,
                  pageInsights: contentAnalysis.pageInsights || [],
                  recommendedStartPage: contentAnalysis.recommendedStartPage || 1
                };
                
                // Add the extended fields as any to avoid TypeScript errors
                (content.contentAnalysis as any).title = originalMetadata.title;
                (content.contentAnalysis as any).author = originalMetadata.author;
                (content.contentAnalysis as any).fiction = !originalMetadata.isNonFiction;
                (content.contentAnalysis as any).first_page = contentAnalysis.first_page || '';
                (content.contentAnalysis as any).second_page = contentAnalysis.second_page || '';
                
                if (contentAnalysis.recommendedStartPage) {
                  content.recommendedStartPage = contentAnalysis.recommendedStartPage;
                }
              } else {
                // Fall back to just saving our original metadata
                fs.writeFile(metadataFilePath, JSON.stringify(analysisData, null, 2), (err) => {
                  if (err) {
                    console.error('Error saving fallback metadata file:', err);
                  } else {
                    console.log(`Fallback metadata saved to ${metadataFilePath}`);
                  }
                });
                
                // IMPORTANT - Create a fallback content analysis if it doesn't exist
                if (!content.contentAnalysis) {
                  try {
                    console.log('Using fallback metadata from original source');
                    // Save a minimal metadata file with basic book info
                    fs.writeFile(metadataFilePath, JSON.stringify({
                      title: originalMetadata.title,
                      author: originalMetadata.author,
                      isNonFiction: originalMetadata.isNonFiction
                    }, null, 2), (err) => {
                      if (err) {
                        console.error('Error saving fallback metadata file:', err);
                      } else {
                        console.log(`Fallback metadata saved to ${metadataFilePath}`);
                      }
                    });
                    
                    // IMPORTANT - Check for OCR results before creating content analysis
                    const ocrResultsPath = path.join(process.cwd(), 'cache', 'book-images', googleBooksData.id, 'ocr_results.json');
                    if (!fs.existsSync(ocrResultsPath)) {
                      console.log(`No OCR results found at ${ocrResultsPath}. Cannot create content_analysis.json without OCR results.`);
                    } 
                    // Only create content analysis if OCR results exist
                    else if (!content.contentAnalysis && fs.existsSync(ocrResultsPath)) {
                      // Create a minimal content analysis result with the original metadata
                      content.contentAnalysis = {
                        firstContentPage: 1,
                        isNonFiction: originalMetadata.isNonFiction,
                        confidence: 0.5,
                        pageInsights: [],
                        recommendedStartPage: 1
                      };
                      
                      // Add the extended fields as any to avoid TypeScript errors
                      (content.contentAnalysis as any).title = originalMetadata.title;
                      (content.contentAnalysis as any).author = originalMetadata.author;
                      (content.contentAnalysis as any).fiction = !originalMetadata.isNonFiction;
                      (content.contentAnalysis as any).first_page = '';
                      (content.contentAnalysis as any).second_page = '';
                      
                      // Set recommended start page even without content analysis
                      content.recommendedStartPage = 1;
                      
                      console.log(`Created fallback content analysis with original metadata - title="${originalMetadata.title}", author="${originalMetadata.author}", isNonFiction=${originalMetadata.isNonFiction}`);
                      
                      // Save content_analysis.json since OCR results exist
                      fs.writeFile(metadataFilePath, JSON.stringify({
                        title: originalMetadata.title,
                        author: originalMetadata.author,
                        fiction: !originalMetadata.isNonFiction,
                        isNonFiction: originalMetadata.isNonFiction,
                        first_page: '',
                        second_page: ''
                      }, null, 2), (err) => {
                        if (err) {
                          console.error('Error saving fallback content analysis file:', err);
                        } else {
                          console.log(`Fallback content analysis saved to ${metadataFilePath}`);
                        }
                      });
                    }
                  } catch (error) {
                    console.error('Error creating fallback metadata:', error);
                  }
                }
              }
              
              console.log('Content analysis complete with original metadata');
              console.log(`Final metadata in content analysis: title="${originalMetadata.title}", author="${originalMetadata.author}", isNonFiction=${originalMetadata.isNonFiction}`);
            }
          } catch (error) {
            console.error('Error analyzing content:', error);
            
            // IMPORTANT - Create a minimal content analysis even after error, using original metadata
            content.contentAnalysis = {
              firstContentPage: 1,
              isNonFiction: originalMetadata.isNonFiction,
              confidence: 0.5,
              pageInsights: [],
              recommendedStartPage: 1
            };
            
            // Add the extended fields as any to avoid TypeScript errors
            (content.contentAnalysis as any).title = originalMetadata.title;
            (content.contentAnalysis as any).author = originalMetadata.author;
            (content.contentAnalysis as any).fiction = !originalMetadata.isNonFiction;
            (content.contentAnalysis as any).first_page = '';
            (content.contentAnalysis as any).second_page = '';
            
            // Set a default recommended start page
            content.recommendedStartPage = 1;
            
            console.log(`Created error fallback content analysis with original metadata - title="${originalMetadata.title}", author="${originalMetadata.author}", isNonFiction=${originalMetadata.isNonFiction}`);
          }
        }
      }
    }
    
    // Clean up old cached images to save disk space
    await bookImageCache.cleanupCache();
    
    // Add logging for image processing
    addSilentLog(`Starting image generation. Preview count: ${content.previewImages?.length || 0}`);
    
    // CRITICAL: ALWAYS ensure original metadata is preserved in the final result
    // Re-apply the original metadata as a final step to ensure it's returned correctly
    content.metadata = originalMetadata;
    
    if (content.contentAnalysis) {
      // Update content analysis type-safely
      const updatedAnalysis = { ...content.contentAnalysis };
      
      // Add metadata fields as any to avoid TypeScript errors
      (updatedAnalysis as any).title = originalMetadata.title;
      (updatedAnalysis as any).author = originalMetadata.author;
      (updatedAnalysis as any).fiction = !originalMetadata.isNonFiction;
      updatedAnalysis.isNonFiction = originalMetadata.isNonFiction;
      
      // Reassign the updated analysis
      content.contentAnalysis = updatedAnalysis;
    }
    
    // FINAL VALIDATION: Make sure we have a recommendedStartPage
    if (!content.recommendedStartPage) {
      content.recommendedStartPage = 1;
      console.log('Setting default recommendedStartPage to 1');
    }
    
    // FINAL CHECK: Ensure content_analysis.json has the correct metadata
    // This covers cases where book ID might have changed during processing
    if (content.googleBooksData?.id) {
      console.log('Making final check of content_analysis.json metadata');
      await ensureContentAnalysisMetadata(content.googleBooksData.id, originalMetadata);
      
      // Check if content_analysis.json already has first_page and second_page
      const contentAnalysisPath = path.join(process.cwd(), 'cache', 'book-images', content.googleBooksData.id, 'content_analysis.json');
      let needsContentCleanup = true;
      
      if (fs.existsSync(contentAnalysisPath)) {
        try {
          const contentAnalysisData = fs.readFileSync(contentAnalysisPath, 'utf8');
          const analysisJson = JSON.parse(contentAnalysisData);
          
          // Check if we have both required page content fields with text
          if (analysisJson.first_page && 
              analysisJson.second_page && 
              analysisJson.first_page.length > 50 &&
              analysisJson.second_page.length > 50 &&
              !analysisJson.first_page.includes("Error extracting content") &&
              !analysisJson.second_page.includes("Error extracting content")) {
            console.log('Content analysis already has valid first and second page content');
            needsContentCleanup = false;
          } else {
            console.log('Content analysis exists but needs page content cleanup');
          }
        } catch (error) {
          console.error('Error checking content analysis file:', error);
        }
      }
      
      // FINAL STEP: Clean up OCR text for better readability
      // ALWAYS do this step to ensure content pages are properly extracted and cleaned
      try {
        logMilestone('OCR_CLEANUP_START', 'Starting OCR text cleanup');
        await cleanBookContentPages(content.googleBooksData.id);
        logMilestone('OCR_CLEANUP_COMPLETE', 'OCR text cleanup completed successfully');
        
        // Verify the cleanup actually worked
        if (fs.existsSync(contentAnalysisPath)) {
          try {
            const updatedData = fs.readFileSync(contentAnalysisPath, 'utf8');
            const updatedAnalysis = JSON.parse(updatedData);
            
            if (!updatedAnalysis.first_page || 
                !updatedAnalysis.second_page || 
                updatedAnalysis.first_page.length < 50 ||
                updatedAnalysis.second_page.length < 50 ||
                updatedAnalysis.first_page.includes("Error extracting content") ||
                updatedAnalysis.second_page.includes("Error extracting content")) {
              
              console.log('Content cleanup did not produce valid results, will retry with getFirstAndSecondContentPages');
              
              // Get the path to OCR results
              const ocrResultsPath = path.join(process.cwd(), 'cache', 'book-images', content.googleBooksData.id, 'ocr_results.json');
              
              if (fs.existsSync(ocrResultsPath)) {
                // Import the function directly from the bookAnalysis module
                const getFirstAndSecondPages = bookAnalysis.getFirstAndSecondContentPages;
                
                // Run the direct extraction
                const extractionResult = await getFirstAndSecondPages(
                  ocrResultsPath,
                  updatedAnalysis.title,
                  updatedAnalysis.author,
                  updatedAnalysis.isNonFiction
                );
                
                // Update content analysis with the extracted content
                updatedAnalysis.first_page = extractionResult.first_page;
                updatedAnalysis.second_page = extractionResult.second_page;
                
                // Save the updated analysis
                fs.writeFileSync(contentAnalysisPath, JSON.stringify(updatedAnalysis, null, 2));
                console.log('Successfully extracted and saved page content');
              }
            }
          } catch (verifyError) {
            console.error('Error verifying content cleanup results:', verifyError);
          }
        }
      } catch (cleanupError) {
        console.error('Error cleaning book content pages:', cleanupError);
        logMilestone('OCR_CLEANUP_ERROR', 'Error during OCR text cleanup');
      }
    }
    if (originalBookId) {
      await ensureContentAnalysisMetadata(originalBookId, originalMetadata);
    }
    
    // Set status to complete before returning
    content.status = 'complete';
    
    console.log(`FINAL VERIFICATION - Metadata in returned object: title="${content.metadata.title}", author="${content.metadata.author}", isNonFiction=${content.metadata.isNonFiction}`);
    console.log(`Recommended start page: ${content.recommendedStartPage}`);
    console.log(`Book availability status: ${content.isAvailable ? 'Available' : 'Not Available'}`);
    console.log(`Book processing status: ${content.status}`);
    
    // Add final logging
    addSilentLog('Book content processing complete');
    addSilentLog(`Final content analysis status: ${content.contentAnalysis ? 'Complete' : 'Not available'}`);
    addSilentLog(`Final metadata values: title="${content.metadata.title}", author="${content.metadata.author}", isNonFiction=${content.metadata.isNonFiction}`);
    addSilentLog(`Final recommended start page: ${content.recommendedStartPage}`);
    addSilentLog(`Final availability status: ${content.isAvailable ? 'Available' : 'Not Available'}`);
    addSilentLog(`Final processing status: ${content.status}`);
    if (!content.isAvailable && content.error) {
      addSilentLog(`Error details: ${content.error.message} (${content.error.code || 'NO_CODE'})`);
    }
    addSilentLog('=== BOOK CONTENT PROCESSING FINISHED ===');
    
    return content;
  } catch (error) {
    // Log error details
    addSilentLog('=== ERROR IN BOOK CONTENT PROCESSING ===');
    addSilentLog(`Error message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      addSilentLog(`Stack trace: ${error.stack}`);
    }
    addSilentLog('=== END ERROR DETAILS ===');
    
    // Return a structured error response instead of throwing
    // This allows the frontend to show a meaningful error message
    const errorResponse: BookContent = {
      metadata: {
        isBook: false,
        title: 'Error',
        author: 'System',
        confidence: 0
      },
      isAvailable: false,
      status: 'error',
      error: {
        message: `An error occurred while processing your book: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'PROCESSING_ERROR'
      }
    };
    
    logMilestone('PROCESSING_ERROR');
    console.error('Returning error response to frontend:', errorResponse.error?.message || 'Unknown error');
    
    return errorResponse;
  }
};

/**
 * Clean book content pages using the getFirstAndSecondContentPages function
 * This uses GPT-4o to clean OCR text and improve readability
 */
export async function cleanBookContentPages(bookId: string): Promise<boolean> {
  try {
    console.log(`Cleaning book content pages for ${bookId}...`);
    
    // Path to the book directory
    const bookDir = path.join(process.cwd(), 'cache', 'book-images', bookId);
    
    // Check if ocr_results.json exists
    const ocrFilePath = path.join(bookDir, 'ocr_results.json');
    if (!fs.existsSync(ocrFilePath)) {
      console.log(`No OCR results found for book ${bookId}. Cannot create content_analysis.json without OCR results.`);
      return false;
    }
    
    // Check if content_analysis.json exists, if not create it with basic structure
    const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
    let contentAnalysis: any = {};
    
    if (fs.existsSync(contentAnalysisPath)) {
      try {
        const contentAnalysisData = fs.readFileSync(contentAnalysisPath, 'utf8');
        contentAnalysis = JSON.parse(contentAnalysisData);
      } catch (readError) {
        console.error(`Error reading content analysis for ${bookId}:`, readError);
        // Continue with empty object
      }
    }
    
    // Get metadata from various sources to use for the content analysis
    if (Object.keys(contentAnalysis).length === 0) {
      console.log(`Creating new content analysis for book ${bookId}`);
      
      // Try to find metadata in a metadata.json file
      const metadataPath = path.join(bookDir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataData = fs.readFileSync(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataData);
          
          // Use metadata to prepopulate the content analysis
          contentAnalysis = {
            title: metadata.title || 'Unknown Title',
            author: metadata.author || 'Unknown Author',
            fiction: metadata.isNonFiction === undefined ? undefined : !metadata.isNonFiction,
            isNonFiction: metadata.isNonFiction
          };
        } catch (metadataError) {
          console.error(`Error reading metadata for ${bookId}:`, metadataError);
        }
      }
      
      // Also check for an id_mapping.json file which might have original metadata
      const mappingPath = path.join(bookDir, 'id_mapping.json');
      if (fs.existsSync(mappingPath)) {
        try {
          const mappingData = fs.readFileSync(mappingPath, 'utf8');
          const mapping = JSON.parse(mappingData);
          
          if (mapping.originalMetadata) {
            contentAnalysis = {
              ...contentAnalysis,
              title: mapping.originalMetadata.title || contentAnalysis.title || 'Unknown Title',
              author: mapping.originalMetadata.author || contentAnalysis.author || 'Unknown Author',
              fiction: mapping.originalMetadata.isNonFiction === undefined ? 
                      contentAnalysis.fiction : 
                      !mapping.originalMetadata.isNonFiction,
              isNonFiction: mapping.originalMetadata.isNonFiction === undefined ?
                           contentAnalysis.isNonFiction :
                           mapping.originalMetadata.isNonFiction
            };
          }
        } catch (mappingError) {
          console.error(`Error reading mapping for ${bookId}:`, mappingError);
        }
      }
    }
    
    // Use the getFirstAndSecondContentPages function to process OCR text
    const title = contentAnalysis.title || '';
    const author = contentAnalysis.author || '';
    
    // Determine fiction status from various possible field names
    let isNonFiction: boolean | undefined = undefined;
    if (contentAnalysis.isNonFiction !== undefined) {
      isNonFiction = contentAnalysis.isNonFiction;
    } else if (contentAnalysis.fiction !== undefined) {
      isNonFiction = !contentAnalysis.fiction;
    }
    
    console.log(`Processing book "${title}" by ${author} (Non-Fiction: ${isNonFiction})`);
    
    // Clean up the OCR text using getFirstAndSecondContentPages
    const result = await bookAnalysis.getFirstAndSecondContentPages(
      ocrFilePath,
      title,
      author,
      isNonFiction
    );
    
    console.log('OCR cleanup complete. Updating content analysis...');
    
    // Update the content_analysis.json file with the cleaned text
    contentAnalysis.first_page = result.first_page || contentAnalysis.first_page;
    contentAnalysis.second_page = result.second_page || contentAnalysis.second_page;
    
    // Ensure title and author are included from the result if available
    if (result.title) {
      contentAnalysis.title = result.title;
    }
    
    if (result.author) {
      contentAnalysis.author = result.author;
    }
    
    // Ensure fiction status is correct
    if (result.fiction !== undefined) {
      contentAnalysis.fiction = result.fiction;
      contentAnalysis.isNonFiction = !result.fiction;
    }
    
    // Verify we have proper content before saving
    if (!contentAnalysis.first_page || 
        !contentAnalysis.second_page || 
        contentAnalysis.first_page === "Error extracting content" || 
        contentAnalysis.second_page === "Error extracting content") {
      
      console.log("Content extraction failed, trying alternative approach with OpenAI directly");
      
      try {
        // Read OCR results
        const ocrData = fs.readFileSync(ocrFilePath, 'utf8');
        const ocrResults = JSON.parse(ocrData);
        
        // Directly use OpenAI to clean the text
        const openaiResult = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert in book content extraction and OCR cleanup. Extract and clean the first two content pages from OCR results.`
            },
            {
              role: 'user',
              content: `I have OCR results from a book titled "${title}" by ${author}. Please extract and clean the text for the first two real content pages (after any front matter).

OCR Results:
${JSON.stringify(ocrResults)}

Please return a JSON object with:
- first_page: The cleaned text of the first content page
- second_page: The cleaned text of the second content page`
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 2000
        });
        
        if (openaiResult.choices[0].message.content) {
          const cleanedContent = JSON.parse(openaiResult.choices[0].message.content);
          
          if (cleanedContent.first_page && cleanedContent.first_page.length > 50) {
            contentAnalysis.first_page = cleanedContent.first_page;
          }
          
          if (cleanedContent.second_page && cleanedContent.second_page.length > 50) {
            contentAnalysis.second_page = cleanedContent.second_page;
          }
          
          console.log("Successfully extracted content using direct OpenAI approach");
        }
      } catch (openaiError) {
        console.error("Error using direct OpenAI approach:", openaiError);
      }
    }
    
    // Save the updated content analysis
    fs.writeFileSync(contentAnalysisPath, JSON.stringify(contentAnalysis, null, 2));
    console.log(`Updated content analysis file for ${bookId} with cleaned text`);
    
    // Also update any linked book IDs to ensure consistency
    try {
      const mappingPath = path.join(bookDir, 'id_mapping.json');
      if (fs.existsSync(mappingPath)) {
        const mappingData = fs.readFileSync(mappingPath, 'utf8');
        const mapping = JSON.parse(mappingData);
        
        // Check for originalId link
        if (mapping.originalId && mapping.originalId !== bookId) {
          const originalOcrPath = path.join(process.cwd(), 'cache', 'book-images', mapping.originalId, 'ocr_results.json');
          // CRITICAL CHANGE: Only create content_analysis.json if OCR results exist
          if (fs.existsSync(originalOcrPath)) {
            const originalDir = path.join(process.cwd(), 'cache', 'book-images', mapping.originalId);
            if (!fs.existsSync(originalDir)) {
              fs.mkdirSync(originalDir, { recursive: true });
            }
            
            const originalAnalysisPath = path.join(originalDir, 'content_analysis.json');
            fs.writeFileSync(originalAnalysisPath, JSON.stringify(contentAnalysis, null, 2));
            console.log(`Updated linked content analysis for originalId ${mapping.originalId}`);
          } else {
            console.log(`Skipping content analysis update for originalId ${mapping.originalId} - no OCR results file`);
          }
        }
        
        // Check for googleBooksId link
        if (mapping.googleBooksId && mapping.googleBooksId !== bookId) {
          const googleOcrPath = path.join(process.cwd(), 'cache', 'book-images', mapping.googleBooksId, 'ocr_results.json');
          // CRITICAL CHANGE: Only create content_analysis.json if OCR results exist
          if (fs.existsSync(googleOcrPath)) {
            const googleDir = path.join(process.cwd(), 'cache', 'book-images', mapping.googleBooksId);
            if (!fs.existsSync(googleDir)) {
              fs.mkdirSync(googleDir, { recursive: true });
            }
            
            const googleAnalysisPath = path.join(googleDir, 'content_analysis.json');
            fs.writeFileSync(googleAnalysisPath, JSON.stringify(contentAnalysis, null, 2));
            console.log(`Updated linked content analysis for googleBooksId ${mapping.googleBooksId}`);
          } else {
            console.log(`Skipping content analysis update for googleBooksId ${mapping.googleBooksId} - no OCR results file`);
          }
        }
      }
    } catch (linkError) {
      console.error("Error updating linked content analysis files:", linkError);
    }
    
    return true;
  } catch (error) {
    console.error(`Error cleaning book content pages: ${error}`);
    return false;
  }
}



