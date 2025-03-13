import { Request, Response } from 'express';
import { analyzeBookImage, getBookContent } from '../services/bookService';
import * as fs from 'fs';
import * as path from 'path';
import { setupLogging, saveLogsAndRestore, logMilestone, addSilentLog } from '../utils/logUtils';

// Import types to ensure we have proper typing
import type { BookContent, BookMetadata } from '../types/bookTypes';

/**
 * Controller to process a book image
 * Validates if the image is a book cover and extracts text
 */
export const processBookImage = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('Received process-book request with body:', req.body);
    const { imageUrl, bookId } = req.body;

    if (!imageUrl) {
      console.error('Missing imageUrl in request body');
      res.status(400).json({ error: 'Image URL is required' });
      return;
    }

    // Use provided bookId or generate a unique one
    const processBookId = bookId || `book_${Date.now()}`;
    console.log(`Processing image from URL with ID: ${processBookId}`);
    
    // Set up logging for this book processing
    setupLogging(processBookId);
    
    // Log EVERYTHING from the request
    logMilestone('REQUEST_RECEIVED', 'New process-book request received');
    
    // Log complete request details (headers, body, etc.)
    addSilentLog('=== COMPLETE REQUEST DETAILS ===');
    addSilentLog(`Timestamp: ${new Date().toISOString()}`);
    addSilentLog(`Request Method: ${req.method}`);
    addSilentLog(`Request URL: ${req.originalUrl}`);
    addSilentLog(`Remote IP: ${req.ip}`);
    
    // Log headers (but filter out sensitive ones)
    addSilentLog('--- Headers ---');
    const filteredHeaders = { ...req.headers };
    // Remove potentially sensitive headers
    ['authorization', 'cookie', 'set-cookie'].forEach(h => {
      if (filteredHeaders[h]) filteredHeaders[h] = '[REDACTED]';
    });
    addSilentLog(JSON.stringify(filteredHeaders, null, 2));
    
    // Log query parameters if any
    if (Object.keys(req.query).length > 0) {
      addSilentLog('--- Query Parameters ---');
      addSilentLog(JSON.stringify(req.query, null, 2));
    }
    
    // Log request body
    addSilentLog('--- Request Body ---');
    addSilentLog(JSON.stringify(req.body, null, 2));
    
    // Add a separator
    addSilentLog('=== END REQUEST DETAILS ===\n');
    
    logMilestone('API_REQUEST_START', 'Processing book image request');

    // First, analyze the image to check if it's a book and extract metadata
    logMilestone('IMAGE_ANALYSIS_START', 'Analyzing book cover image');
    const bookMetadata = await analyzeBookImage(imageUrl);
    logMilestone('IMAGE_ANALYSIS_COMPLETE', 'Book cover analysis complete');
    
    // Log the metadata result
    addSilentLog('=== BOOK METADATA ANALYSIS RESULT ===');
    addSilentLog(JSON.stringify(bookMetadata, null, 2));
    addSilentLog('=== END METADATA ANALYSIS ===\n');

    // If the image isn't recognized as a book, return an error
    if (!bookMetadata.isBook) {
      logMilestone('NOT_A_BOOK', 'Image not recognized as a book cover');
      saveLogsAndRestore({
        status: 'invalid',
        reason: 'not_a_book',
        imageUrl: imageUrl
      });
      res.status(400).json({ 
        error: 'The provided image does not appear to be a book cover.',
        isBook: false,
        bookId: processBookId
      });
      return;
    }

    // If it is a book, start processing the content
    console.log('Image is a book, retrieving content...');
    logMilestone('BOOK_CONTENT_START', `Getting book content for "${bookMetadata.title || 'unknown'}"`);

    // Create a timeout promise to fail after 60 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Book processing timeout'));
      }, 60000); // 60 seconds timeout
    });

    // Main content processing promise
    const bookContentPromise = getBookContent(imageUrl, bookMetadata, processBookId);
    
    // Wait for either promise to resolve
    let bookContent: BookContent;
    try {
      bookContent = await Promise.race([bookContentPromise, timeoutPromise]) as unknown as BookContent;
      logMilestone('BOOK_CONTENT_COMPLETE', 'Book content processing complete');
      
      // Log a summary of the content retrieved
      addSilentLog('=== BOOK CONTENT PROCESSING RESULT ===');
      addSilentLog(`Title: ${bookContent.metadata.title || 'Unknown'}`);
      addSilentLog(`Author: ${bookContent.metadata.author || 'Unknown'}`);
      addSilentLog(`Non-Fiction: ${bookContent.metadata.isNonFiction ? 'Yes' : 'No'}`);
      addSilentLog(`Preview Images: ${bookContent.previewImages?.length || 0}`);
      addSilentLog(`Sequential Pages: ${bookContent.sequentialPages?.imagePaths.length || 0}`);
      if (bookContent.contentAnalysis) {
        addSilentLog(`Content Analysis Confidence: ${bookContent.contentAnalysis.confidence}`);
        addSilentLog(`First Content Page: ${bookContent.contentAnalysis.firstContentPage}`);
      }
      addSilentLog('=== END CONTENT PROCESSING ===\n');
    } catch (timeoutError) {
      logMilestone('BOOK_CONTENT_TIMEOUT', 'Book content processing timed out');
      console.error('Timed out getting book content:', timeoutError);
      saveLogsAndRestore({
        status: 'timeout',
        title: bookMetadata.title || 'unknown',
        author: bookMetadata.author || 'unknown',
        error: String(timeoutError)
      });
      res.status(504).json({ 
        error: 'Book processing timed out. Please try again.',
        isBook: true,
        metadata: {
          title: bookMetadata.title,
          author: bookMetadata.author,
          isNonFiction: bookMetadata.isNonFiction
        },
        bookId: processBookId
      });
      return;
    }
    
    console.log('Book processing complete, isNonFiction:', bookContent.metadata.isNonFiction);
    console.log('Preview images generated:', bookContent.previewImages?.length || 0);
    console.log('Sequential pages generated:', bookContent.sequentialPages?.imagePaths.length || 0);
    console.log('Recommended start page:', bookContent.recommendedStartPage);

    // Format OCR results for the response
    const formattedOcrResults = bookContent.sequentialPages?.ocrResults.map((ocr: any) => ({
      pageNumber: ocr.pageNumber,
      text: ocr.text,
      confidence: ocr.confidence,
      imagePath: `/api/book-images/${ocr.imagePath.split('/').pop()}`
    })) || [];

    // Format page insights for the response
    const pageInsights = bookContent.contentAnalysis?.pageInsights.map((insight: any) => ({
      pageNumber: insight.pageNumber,
      contentType: insight.contentType,
      isFrontMatter: insight.isFrontMatter,
      isMainContent: insight.isMainContent,
      summary: insight.summary
    })) || [];

    const response = {
      metadata: bookContent.metadata,
      previewText: bookContent.pages?.[0] || '',
      previewImages: bookContent.previewImages?.map((img: string) => `/api/book-images/${img.split('/').pop()}`) || [],
      ocrResults: formattedOcrResults,
      contentAnalysis: bookContent.contentAnalysis ? {
        firstContentPage: bookContent.contentAnalysis.firstContentPage,
        isNonFiction: bookContent.contentAnalysis.isNonFiction,
        confidence: bookContent.contentAnalysis.confidence,
        pageInsights: pageInsights,
      } : null,
      bookId: processBookId,
      recommendedStartPage: bookContent.recommendedStartPage || 1
    };
    
    // Log the response being sent
    addSilentLog('=== API RESPONSE ===');
    addSilentLog(`Status: 200 OK`);
    addSilentLog(`Response Body Summary:`);
    addSilentLog(`- Book ID: ${processBookId}`);
    addSilentLog(`- Title: ${bookContent.metadata.title || 'Unknown'}`);
    addSilentLog(`- Author: ${bookContent.metadata.author || 'Unknown'}`);
    addSilentLog(`- Preview Images: ${response.previewImages.length}`);
    addSilentLog(`- OCR Results: ${formattedOcrResults.length} pages`);
    addSilentLog('=== END API RESPONSE ===\n');
    
    // Log success and save logs
    logMilestone('API_REQUEST_COMPLETE', 'Book processing completed successfully');
    saveLogsAndRestore({
      status: 'success',
      title: bookContent.metadata.title || 'unknown',
      author: bookContent.metadata.author || 'unknown',
      isNonFiction: bookContent.metadata.isNonFiction,
      previewImages: bookContent.previewImages?.length || 0,
      sequentialPages: bookContent.sequentialPages?.imagePaths.length || 0
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('Error processing book:', error);
    
    // Try to extract the book ID if it was generated
    let bookId = req.body.bookId || null;
    if (!bookId && req.body && typeof req.body === 'object') {
      // Try to find processBookId in the error scope
      const errorString = String(error);
      const idMatch = errorString.match(/book_\d+/);
      if (idMatch) {
        bookId = idMatch[0];
      }
    }
    
    // If we have a book ID, log the error
    if (bookId) {
      logMilestone('API_REQUEST_ERROR', 'Error during book processing');
      addSilentLog('=== ERROR DETAILS ===');
      addSilentLog(`Error: ${String(error)}`);
      if (error instanceof Error && error.stack) {
        addSilentLog('Stack Trace:');
        addSilentLog(error.stack);
      }
      addSilentLog('=== END ERROR DETAILS ===\n');
      
      saveLogsAndRestore({
        status: 'error',
        error: String(error),
        request: req.body
      });
    }
    
    res.status(500).json({ error: 'Failed to process book', details: String(error) });
  }
}; 