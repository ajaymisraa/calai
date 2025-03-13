import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { bookId } = req.query;

  if (!bookId || typeof bookId !== 'string') {
    return res.status(400).json({ error: 'Book ID is required' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get processor API URL from environment variables
    const processorApiUrl = process.env.PROCESSOR_API_URL || 'http://localhost:3002';
    
    // Use the processor API URL directly without adding /api
    const baseUrl = processorApiUrl;
    
    console.log(`Forwarding request to: ${baseUrl}/content-analysis/${bookId}`);
    
    // Check if we have local cached info about this book (from upload)
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const bookInfoPath = path.join(uploadDir, `${bookId}.meta.json`);
    let bookInfo = null;
    
    // Try to read cached book info if it exists
    if (fs.existsSync(bookInfoPath)) {
      try {
        const bookInfoData = fs.readFileSync(bookInfoPath, 'utf8');
        bookInfo = JSON.parse(bookInfoData);
        console.log(`Found cached book info for ${bookId}:`, bookInfo);
      } catch (readError) {
        console.error('Error reading cached book info:', readError);
      }
    }
    
    // Check if processor service is available
    try {
      // Optional: Make a lightweight request to check if service is up
      await axios.head(baseUrl, { timeout: 5000 });
    } catch (serviceError: any) {
      console.error('Processor service unavailable:', serviceError.message);
      
      // If we have cached book info, check if we can find content directly
      if (bookInfo && bookInfo.title) {
        // First check if there's a Google Books ID mapping for this book
        try {
          // Check for content in both the original ID's directory and potential Google Books ID
          const originalBookId = req.query.bookId as string;
          const path = require('path');
          const fs = require('fs');
          
          // Check for id_mapping.json in the book's directory
          const mappingPath = path.join(process.cwd(), '..', 'processor', 'cache', 'book-images', originalBookId, 'id_mapping.json');
          
          if (fs.existsSync(mappingPath)) {
            const mappingData = fs.readFileSync(mappingPath, 'utf8');
            const mapping = JSON.parse(mappingData);
            
            if (mapping.googleBooksId) {
              const googleBooksId = mapping.googleBooksId;
              const contentPath = path.join(process.cwd(), '..', 'processor', 'cache', 'book-images', googleBooksId, 'content_analysis.json');
              
              // If content exists for the Google Books ID, use it
              if (fs.existsSync(contentPath)) {
                const contentData = fs.readFileSync(contentPath, 'utf8');
                const content = JSON.parse(contentData);
                
                console.log(`Found content_analysis.json for Google Books ID ${googleBooksId}`);
                
                // We found content! Return it with the book info
                return res.status(200).json({
                  isNonFiction: !content.fiction,
                  firstPageContent: content.first_page,
                  secondPageContent: content.second_page,
                  first_page: content.first_page,
                  second_page: content.second_page,
                  fiction: content.fiction,
                  recommendedContent: content.fiction ? content.second_page : content.first_page,
                  title: content.title || bookInfo.title,
                  author: content.author || bookInfo.author,
                  isAvailable: true,
                  processingComplete: true,
                  processingSuccess: true
                });
              }
            }
          }
        } catch (mappingError) {
          console.error('Error checking for id mapping:', mappingError);
          // Continue with the standard error response if we couldn't find content
        }
        
        // Check if we have a specific error code stored in the book info
        const errorCode = bookInfo.error?.code || 'SERVICE_UNAVAILABLE';
        const errorMessage = bookInfo.error?.message || 'The book content service is temporarily unavailable. Please try again shortly.';
        
        // Use a more specific error message if this is a processing error
        if (errorCode === 'PROCESSING_ERROR') {
          return res.status(200).json({
            status: 'error',
            isAvailable: true,
            title: bookInfo.title || 'Unknown Book',
            author: bookInfo.author || 'Unknown Author',
            isNonFiction: bookInfo.isNonFiction,
            processingStarted: bookInfo.processingStarted || false,
            processingComplete: bookInfo.processingComplete || false,
            error: {
              message: errorMessage,
              code: errorCode
            }
          });
        }
        
        // Override isAvailable to true if we have title and author
        return res.status(200).json({
          status: 'error',
          isAvailable: true,
          title: bookInfo.title,
          author: bookInfo.author,
          isNonFiction: bookInfo.isNonFiction,
          processingStarted: bookInfo.processingStarted || false,
          processingComplete: bookInfo.processingComplete || false,
          error: {
            message: errorMessage,
            code: errorCode
          }
        });
      }
      
      // Otherwise send a generic error
      return res.status(503).json({
        status: 'error',
        isAvailable: false,
        error: {
          message: 'Book processing service is currently unavailable. Please try again later.',
          code: 'SERVICE_UNAVAILABLE'
        }
      });
    }
    
    // Forward the request to the processor service
    const response = await axios.get(`${baseUrl}/content-analysis/${bookId}`, {
      timeout: 120000 // 2 minutes timeout
    }).catch(async (contentError) => {
      // If the content-analysis endpoint returns 404, check if the book might 
      // still be processing by calling the book-status endpoint
      if (contentError.response && contentError.response.status === 404) {
        try {
          const statusResponse = await axios.get(`${baseUrl}/book-status/${bookId}`, { 
            timeout: 10000
          });
          
          // Return the status information if available
          if (statusResponse.data) {
            return { data: statusResponse.data, status: 200 };
          }
        } catch (statusError) {
          console.error('Error checking book status:', statusError);
          // Continue to the error handling below
        }
      }
      
      // If we have cached book info, provide a better error response
      if (bookInfo && bookInfo.title) {
        // Check if we have a specific error saved in book info
        const errorCode = bookInfo.error?.code || 'BOOK_PROCESSING';
        const errorMessage = bookInfo.error?.message || 'Your book is still being processed. Please wait a moment.';
        
        return { 
          data: {
            status: bookInfo.error ? 'error' : 'processing',
            isAvailable: true,
            title: bookInfo.title,
            author: bookInfo.author,
            isNonFiction: bookInfo.isNonFiction,
            processingStarted: bookInfo.processingStarted || true,
            processingComplete: bookInfo.processingComplete || false,
            firstPageContent: '',
            secondPageContent: '',
            error: {
              message: errorMessage,
              code: errorCode
            }
          }, 
          status: 200 
        };
      }
      
      // Re-throw the error if we couldn't handle it
      throw contentError;
    });
    
    // Check if the processor specifically indicated the book is not available
    if (response.data && response.data.status === 'error') {
      // Pass through the error information while keeping any partial data like title/author
      return res.status(200).json({
        ...response.data,
        isAvailable: true,
        status: 'error'
      });
    }
    
    // Ensure we have both sets of field names (first_page/firstPageContent)
    if (response.data) {
      // If we have first_page/second_page but not firstPageContent/secondPageContent, add the latter
      if (response.data.first_page && !response.data.firstPageContent) {
        response.data.firstPageContent = response.data.first_page;
      }
      if (response.data.second_page && !response.data.secondPageContent) {
        response.data.secondPageContent = response.data.second_page;
      }
      
      // If we have firstPageContent/secondPageContent but not first_page/second_page, add the latter
      if (response.data.firstPageContent && !response.data.first_page) {
        response.data.first_page = response.data.firstPageContent;
      }
      if (response.data.secondPageContent && !response.data.second_page) {
        response.data.second_page = response.data.secondPageContent;
      }
      
      // Ensure isNonFiction is set correctly if only fiction is provided
      if (typeof response.data.fiction === 'boolean' && typeof response.data.isNonFiction !== 'boolean') {
        response.data.isNonFiction = !response.data.fiction;
      }
      // Ensure fiction is set correctly if only isNonFiction is provided
      if (typeof response.data.isNonFiction === 'boolean' && typeof response.data.fiction !== 'boolean') {
        response.data.fiction = !response.data.isNonFiction;
      }
    }
    
    // Check for the NO_PAGES_AVAILABLE error flag from the file upload service
    // This handling is important for errors from the background processing task 
    // that we discover after checking the content status
    try {
      const bookStatus = await axios.get(`${baseUrl}/book-status/${bookId}`, { 
        timeout: 10000
      });
      
      if (bookStatus.data && bookStatus.data.status === 'error') {
        // Combine any data from the content analysis with the error information from book status
        const errorCode = bookStatus.data.error?.code || "BOOK_NOT_AVAILABLE";
        
        // Special handling for books not found in database
        if (errorCode === 'NO_PAGES_AVAILABLE' || errorCode === 'BOOK_NOT_FOUND') {
          return res.status(200).json({
            ...response.data,
            isAvailable: true,
            status: 'error',
            error: {
              message: bookStatus.data.error?.message || "We couldn't find this book in our database. Please try uploading a different book.",
              code: errorCode
            }
          });
        }
        
        return res.status(200).json({
          ...response.data,
          isAvailable: true,
          status: 'error',
          error: bookStatus.data.error || {
            message: "The book is not available for preview.",
            code: "BOOK_NOT_AVAILABLE"
          }
        });
      }
    } catch (statusError) {
      // If book status check fails, just continue with the content analysis response
      console.error('Error checking book status:', statusError);
    }
    
    // If we get this far, we have content data - cache it locally for future requests
    if (response.data && (response.data.title || response.data.firstPageContent)) {
      try {
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        fs.writeFileSync(bookInfoPath, JSON.stringify({
          title: response.data.title,
          author: response.data.author,
          isNonFiction: response.data.isNonFiction,
          processingStarted: true,
          processingComplete: true,
          timestamp: new Date().toISOString()
        }));
      } catch (cacheError) {
        console.error('Error caching book info:', cacheError);
      }
    }
    
    // Include processing status in the final response
    const finalResponse = {
      ...response.data,
      processingStarted: true,
      processingComplete: (response.data.firstPageContent && response.data.secondPageContent) || 
                         (response.data.first_page && response.data.second_page) ? true : false
    };
    
    // Return the content analysis data
    return res.status(200).json(finalResponse);
  } catch (error: any) {
    console.error('Error fetching content analysis:', error);
    
    // Special handling for 404 errors (book not found)
    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        status: 'error',
        isAvailable: true,
        error: {
          message: 'This book is not available in our database. It may have been removed or never existed.',
          code: 'BOOK_NOT_FOUND'
        },
        metadata: {
          isBook: true,
          title: 'Unknown Book',
          author: 'Unknown Author'
        }
      });
    }
    
    // Handle timeout errors
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        status: 'error',
        isAvailable: true,
        error: {
          message: 'The book processing request timed out. Please try again later.',
          code: 'REQUEST_TIMEOUT'
        }
      });
    }
    
    // Forward the error status and message from the processor service if available
    if (error.response) {
      const statusCode = error.response.status || 500;
      const errorMessage = error.response.data?.error || 'Error fetching book content analysis';
      
      return res.status(statusCode).json({
        status: 'error',
        isAvailable: true,
        error: {
          message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
          code: `HTTP_${statusCode}`
        }
      });
    }
    
    // Generic error handling
    return res.status(500).json({ 
      status: 'error',
      isAvailable: true,
      error: {
        message: 'An unexpected error occurred while processing your request.',
        code: 'INTERNAL_ERROR'
      }
    });
  }
} 