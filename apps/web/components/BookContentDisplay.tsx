import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import styles from './BookContentDisplay.module.css';

interface BookContentDisplayProps {
  bookId: string;
}

interface ContentAnalysisData {
  isNonFiction: boolean;
  firstPageContent?: string;
  secondPageContent?: string;
  first_page?: string; // From content_analysis.json format
  second_page?: string; // From content_analysis.json format
  fiction?: boolean; // From content_analysis.json format
  recommendedContent?: string;
  title: string;
  author: string;
  status?: string;
  error?: {
    message: string;
    code: string;
  };
  isAvailable?: boolean;
  processingStarted?: boolean;
  processingComplete?: boolean;
  processingSuccess?: boolean;
}

// Create axios instances for different potential endpoints
const bookAxios = axios.create();

// Define potential API patterns to try
const API_PATTERNS = [
  (id: string) => `/api/processor/content-analysis/${id}`,
  (id: string) => `/api/content-analysis/${id}`,
  (id: string) => `http://localhost:3002/api/content-analysis/${id}` // Direct call to service
];

const BookContentDisplay: React.FC<BookContentDisplayProps> = ({ bookId }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<ContentAnalysisData | null>(null);
  const [currentPage, setCurrentPage] = useState<'first' | 'second'>('first');
  const [retryCount, setRetryCount] = useState<number>(0);
  const [polling, setPolling] = useState<boolean>(false);

  const fetchContent = useCallback(async () => {
    if (!bookId) return;
    
    setLoading(true);
    
    // Try each API pattern until one works
    let response = null;
    let lastError = null;
    
    console.log(`Attempting to fetch book content for bookId: ${bookId}`);
    
    // Get cached book info if available
    try {
      // This endpoint seems to work according to your logs
      const cachedInfoResponse = await bookAxios.get(`/api/books/${bookId}`);
      if (cachedInfoResponse.data) {
        console.log("Found cached book info:", cachedInfoResponse.data);
        // Update content with the cached info
        setContent(prevContent => ({
          ...prevContent,
          ...cachedInfoResponse.data,
          title: cachedInfoResponse.data.title || (prevContent?.title || "Loading book..."),
          author: cachedInfoResponse.data.author || (prevContent?.author || "")
        }));
      }
    } catch (cacheErr) {
      console.log("No cached info available:", (cacheErr as Error).message);
    }
    
    // Try each API pattern
    for (const getApiUrl of API_PATTERNS) {
      try {
        const apiUrl = getApiUrl(bookId);
        console.log(`Trying API endpoint: ${apiUrl}`);
        response = await bookAxios.get(apiUrl);
        console.log('API response successful:', JSON.stringify(response.data, null, 2));
        console.log('Book content fields available:', {
          hasFirstPage: !!response.data.first_page,
          firstPageLength: response.data.first_page ? response.data.first_page.length : 0,
          hasSecondPage: !!response.data.second_page,
          secondPageLength: response.data.second_page ? response.data.second_page.length : 0,
          hasFirstPageContent: !!response.data.firstPageContent,
          firstPageContentLength: response.data.firstPageContent ? response.data.firstPageContent.length : 0,
          hasSecondPageContent: !!response.data.secondPageContent,
          secondPageContentLength: response.data.secondPageContent ? response.data.secondPageContent.length : 0,
        });
        
        // Store the response data
        setContent(response.data);
        
        // Successfully got a response, break out of the loop
        break;
      } catch (err) {
        console.log(`Error with endpoint ${getApiUrl(bookId)}:`, (err as Error).message);
        lastError = err;
        // Continue to the next API pattern
      }
    }
    
    // If all API patterns failed
    if (!response) {
      console.error('All API endpoints failed. Last error:', lastError);
      setError('Unable to connect to the book content service. Please try again shortly.');
      setPolling(true);
      setLoading(false);
      setRetryCount(prev => prev + 1);
      return;
    }
    
    try {
      // Continue with successful response processing
      console.log('Processing successful API response:', response.data);
      
      // Store the response data
      setContent(response.data);
      
      // Check if book processing is complete
      const isProcessingComplete = response.data.processingComplete === true;
      
      // Check if book is available (has content or is marked as available)
      const isAvailable = 
        response.data.isAvailable === true || 
        (response.data.firstPageContent && response.data.firstPageContent.length > 0) || 
        (response.data.secondPageContent && response.data.secondPageContent.length > 0);
      
      // Check if processing failed
      const processingFailed = 
        isProcessingComplete && 
        (response.data.processingSuccess === false || response.data.isAvailable === false);
      
      // Handle the different states
      if (!isProcessingComplete) {
        // Book is still processing
        setError('Your book is still being processed. Please wait a moment.');
        setPolling(true);
      } else if (processingFailed) {
        // Book was processed but content is not available
        setError('We couldn&apos;t extract any preview content for this book. It may not be available in our database or may have restricted access.');
        setPolling(false);
      } else if (!isAvailable) {
        // Book was processed but no content is available
        setError('No preview content is available for this book.');
        setPolling(false);
      } else {
        // Book is processed and content is available
        setError(null);
        setPolling(false);
        
        // Set the page based on content type only if we have actual content
        if (response.data.firstPageContent || response.data.secondPageContent) {
          setCurrentPage(response.data.isNonFiction ? 'first' : 'second');
        }
      }
    } catch (err: any) {
      console.error('Error processing book content response:', err);
      
      // Handle service unavailable errors gracefully
      if (err.response?.status === 503 || err.response?.status === 404) {
        // Try to get any book info that might be available in the error response
        if (err.response?.data) {
          setContent(err.response.data);
        }
        
        // Fix: Check for backgroundProcessingComplete status in error response data
        // Check for any indicator that processing is complete in both the logs and response
        const backgroundComplete = 
          err.response?.data?.processingComplete === true || 
          err.response?.data?.backgroundProcessingComplete === true ||
          // Check if the error message or logs contain indication of completion
          err.message?.includes('processing complete') ||
          (typeof err.response?.data === 'string' && err.response?.data.includes('processing complete'));
          
        if (backgroundComplete) {
          // Try again immediately as the processing might be complete now
          console.log("Background processing appears to be complete, retrying immediately");
          setTimeout(fetchContent, 500);
          return;
        }
        
        // If we have book info but it's marked as not available, show that as a final state, not an error
        if (err.response?.data?.processingComplete === true && 
            (err.response?.data?.isAvailable === false || err.response?.data?.processingSuccess === false)) {
          setError('We couldn&apos;t extract any preview content for this book. It may not be available in our database or may have restricted access.');
          setPolling(false);
        } else {
          // Otherwise treat as a temporary service issue and continue polling
          setError('The book content service is temporarily unavailable. Attempting to reconnect...');
          setPolling(true);
        }
      } else if (err.response?.data?.error) {
        // If server returned a structured error
        const errorMsg = err.response.data.error.message || err.response.data.error;
        
        if (typeof errorMsg === 'string' && (
            errorMsg.includes('processing') || 
            errorMsg.includes('still being processed') ||
            errorMsg.includes('check back'))
        ) {
          setError('Your book is still being processed. Please wait a moment.');
          setPolling(true);
        } else {
          setError(errorMsg);
          setPolling(false);
        }
        
        // Save any partial data that might be in the error response
        if (err.response?.data) {
          setContent(err.response.data);
        }
      } else {
        setError(`Failed to load book content: ${err.message || 'Unknown error'}`);
        setPolling(false);
      }
    } finally {
      setLoading(false);
      if (polling) {
        setRetryCount(prev => prev + 1);
      }
    }
  }, [bookId, polling]);

  useEffect(() => {
    // Reset state when bookId changes
    setRetryCount(0);
    setPolling(false);
    setError(null);
    fetchContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);
  
  useEffect(() => {
    let pollingInterval: NodeJS.Timeout | null = null;
    
    if (polling && retryCount < 30) {
      // Start with shorter intervals for first few attempts, then longer backoff
      const baseDelay = retryCount < 3 ? 1000 : 2000; // 1 second base for first 3 attempts
      const pollingDelay = Math.min(
        baseDelay * Math.pow(1.5, Math.min(retryCount, 10)), // Exponential growth up to a point
        30000 // Maximum 30 second delay
      );
      
      console.log(`Polling attempt ${retryCount + 1}/30 - Next attempt in ${Math.round(pollingDelay/1000)}s`);
      
      pollingInterval = setTimeout(() => {
        fetchContent();
      }, pollingDelay);
      
      return () => {
        if (pollingInterval) clearInterval(pollingInterval);
      };
    } else if (retryCount >= 30) {
      // After 30 attempts, stop polling and show a timeout error
      setPolling(false);
      setError('Book processing is taking longer than expected. Please try refreshing the page or upload a different book.');
    }
  }, [polling, retryCount, fetchContent]);

  // Get text content based on current page selection
  const paragraphs = React.useMemo(() => {
    if (!content) return [];

    console.log('Getting paragraphs for page:', currentPage);

    // If we have recommended content and this is the first render, use it
    if (content.recommendedContent && currentPage === 'first' && content.recommendedContent.length > 0) {
      // Automatically select the appropriate page tab based on fiction/non-fiction
      const isNonFic = content.isNonFiction === true || content.fiction === false;
      console.log('Using recommendedContent, isNonFiction:', isNonFic);
      setCurrentPage(isNonFic ? 'first' : 'second');
      return content.recommendedContent.split('\n').filter(p => p.trim().length > 0);
    }
    
    // Get the appropriate page content, checking both field naming styles
    let pageText = '';
    if (currentPage === 'first') {
      // First try the first_page field (original content_analysis.json format)
      if (content.first_page && content.first_page.length > 0) {
        console.log('Using first_page content');
        pageText = content.first_page;
      } 
      // Then try the firstPageContent field (expected frontend format)
      else if (content.firstPageContent && content.firstPageContent.length > 0) {
        console.log('Using firstPageContent');
        pageText = content.firstPageContent;
      }
    } else {
      // First try the second_page field (original content_analysis.json format)
      if (content.second_page && content.second_page.length > 0) {
        console.log('Using second_page content');
        pageText = content.second_page;
      } 
      // Then try the secondPageContent field (expected frontend format)
      else if (content.secondPageContent && content.secondPageContent.length > 0) {
        console.log('Using secondPageContent');
        pageText = content.secondPageContent;
      }
    }
    
    // Split the text into paragraphs
    return pageText ? pageText.split('\n').filter(p => p.trim().length > 0) : [];
  }, [content, currentPage]);

  // Check if the book has any content available
  const hasContent = React.useMemo(() => {
    if (!content) {
      console.log('hasContent: No content object available');
      return false;
    }
    
    console.log('Content check:', {
      firstPageContent: content.firstPageContent ? content.firstPageContent.slice(0, 20) + '...' : 'none',
      secondPageContent: content.secondPageContent ? content.secondPageContent.slice(0, 20) + '...' : 'none',
      first_page: content.first_page ? content.first_page.slice(0, 20) + '...' : 'none',
      second_page: content.second_page ? content.second_page.slice(0, 20) + '...' : 'none',
    });
    
    const hasPages = (content.firstPageContent && content.firstPageContent.length > 0) || 
                    (content.secondPageContent && content.secondPageContent.length > 0) ||
                    (content.first_page && content.first_page.length > 0) ||
                    (content.second_page && content.second_page.length > 0);
    
    console.log('hasContent result:', hasPages);
    return hasPages;
  }, [content]);

  // Determine if this is a processing state
  const isProcessing = React.useMemo(() => {
    if (polling) return true;
    if (!content) return false;
    
    // Check for any indication that processing is not complete
    const stillProcessing = content.processingComplete === false || 
           (!content.processingComplete && content.processingStarted === true) ||
           (content.status === 'processing');
    
    // Also check if we're missing content that would indicate processing is still happening
    const hasFirstPageContent = content.firstPageContent && content.firstPageContent.length > 0;
    const hasFirstPage = content.first_page && content.first_page.length > 0;
    const hasSecondPageContent = content.secondPageContent && content.secondPageContent.length > 0;
    const hasSecondPage = content.second_page && content.second_page.length > 0;
    
    console.log('Processing check fields:', {
      hasFirstPageContent,
      hasFirstPage,
      hasSecondPageContent, 
      hasSecondPage
    });
    
    const hasAnyFirstPage = hasFirstPageContent || hasFirstPage;
    const hasAnySecondPage = hasSecondPageContent || hasSecondPage;
    const missingContent = !hasAnyFirstPage || !hasAnySecondPage;
    
    return stillProcessing || missingContent;
  }, [polling, content]);

  // Determine if this is an availability issue versus a temporary service issue
  const isAvailabilityIssue = React.useMemo(() => {
    if (!content) return false;
    
    return content.processingComplete === true && 
           (content.isAvailable === false || content.processingSuccess === false);
  }, [content]);

  if (loading && retryCount === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-gray-900/90 rounded-lg border border-gray-800 shadow-lg">
        <div className="flex flex-col items-center text-center p-8">
          <div className="relative mb-6">
            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border border-indigo-500/30 animate-spin border-t-indigo-400"></div>
            </div>
          </div>
          <p className="text-white font-medium text-sm">Analyzing book content</p>
          <p className="text-gray-400 text-xs mt-2">Extracting preview pages and analyzing text...</p>
          <p className="text-indigo-400 text-xs mt-4">This typically takes 1-2 minutes</p>
        </div>
      </div>
    );
  }

  // Special case for when processing is complete but content isn't available
  if (isAvailabilityIssue) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-gray-900/90 rounded-lg border border-gray-800 shadow-lg">
        <div className="relative max-w-sm text-center px-8 py-8">
          <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-white text-sm font-medium mb-2">No Preview Available</h3>
          <p className="text-gray-400 text-xs mb-4">
            We couldn&apos;t extract any preview content for this book. It may not be available in our database or may have restricted access.
          </p>
          
          {content && (content.title || content.author) && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-gray-300 text-sm font-medium">{content.title || 'Unknown Title'}</p>
              {content.author && (
                <p className="text-gray-400 text-xs">by {content.author}</p>
              )}
            </div>
          )}
          
          <button
            onClick={() => window.location.href = '/'} 
            className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors duration-200"
          >
            Upload Different Book
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-gray-900/90 rounded-lg border border-gray-800 shadow-lg">
        <div className="relative max-w-sm text-center px-8 py-8">
          <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
            {isProcessing ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-indigo-400 rounded-full animate-spin"></div>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
          </div>
          <h3 className="text-white text-sm font-medium mb-2">
            {isProcessing ? 'Book Processing' : 
             error.includes('service') || error.includes('unavailable') ? 'Service Temporarily Unavailable' : 
             'Book Not Available'}
          </h3>
          <p className="text-gray-400 text-xs mb-4">
            {isProcessing
              ? `We're extracting and analyzing your book content. This can take 1-2 minutes. Checking again in a few seconds... (${retryCount}/30 attempts)`
              : error}
          </p>
          
          {/* Display book title and author if available, even in error state */}
          {content && (content.title || content.author) && !isProcessing && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-gray-300 text-sm font-medium">{content.title}</p>
              {content.author && (
                <p className="text-gray-400 text-xs">by {content.author}</p>
              )}
              <p className="mt-3 text-gray-400 text-xs">
                {error.includes('service') || error.includes('unavailable')
                  ? "Our book content service is temporarily unavailable. Please try again in a few moments."
                  : "This book is not available for preview in our system. Please try another book."}
              </p>
            </div>
          )}
          
          {/* Show the right button based on error type */}
          {!isProcessing && (
            error.includes('service') || error.includes('unavailable') ? (
              <button
                onClick={() => {
                  setRetryCount(0);
                  fetchContent();
                }}
                className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors duration-200"
              >
                Try Again
              </button>
            ) : (
              <button
                onClick={() => window.location.href = '/'} 
                className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors duration-200"
              >
                Upload Different Book
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  if (!content || !hasContent) {
    // Last resort: Try to extract content from the "content" object even if hasContent is false
    // This helps with edge cases where the field detection in hasContent didn't catch the content
    const tryGetContent = () => {
      if (!content) return null;
      
      console.log('Attempting final content extraction check');
      
      // Check explicitly for every possible content field
      const allContentFields = [
        content.first_page, 
        content.second_page,
        content.firstPageContent,
        content.secondPageContent,
        content.recommendedContent
      ];
      
      // Log all content field lengths
      console.log('Content field lengths:', {
        first_page: content.first_page?.length || 0,
        second_page: content.second_page?.length || 0,
        firstPageContent: content.firstPageContent?.length || 0,
        secondPageContent: content.secondPageContent?.length || 0,
        recommendedContent: content.recommendedContent?.length || 0,
      });
      
      // If any content field has meaningful content, extract it for display
      for (const field of allContentFields) {
        if (field && field.length > 100) {  // Minimum 100 chars to be considered valid content
          console.log('Found valid content in field check:', field.substring(0, 30) + '...');
          return field.split('\n').filter(p => p.trim().length > 0);
        }
      }
      
      return null;
    };
    
    // Execute the content extraction function
    const extractedParagraphs = tryGetContent();
    
    // If we've found content, render it instead of the error
    if (extractedParagraphs && extractedParagraphs.length > 0) {
      console.log('Using extracted paragraphs as fallback');
      return (
        <div className="w-full h-full overflow-hidden bg-gray-900 rounded-lg border border-gray-800 shadow-lg transition-all duration-300">
          <div className="h-full flex flex-col overflow-hidden">
            <div className="flex-none p-5 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-semibold text-white">{content?.title || 'Book Preview'}</h1>
                  {content?.author && (
                    <p className="text-sm text-gray-400">by {content?.author}</p>
                  )}
                </div>
                
                <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  (content?.isNonFiction === true || content?.fiction === false) 
                    ? 'bg-purple-900/30 text-purple-300 border border-purple-800/50' 
                    : 'bg-indigo-900/30 text-indigo-300 border border-indigo-800/50'
                }`}>
                  {(content?.isNonFiction === true || content?.fiction === false) ? 'Non-Fiction' : 'Fiction'}
                </div>
              </div>
            </div>
            
            <div className={`flex-1 overflow-auto bg-gray-900 px-6 py-8 ${styles.customScrollbar}`}>
              <div className="max-w-2xl mx-auto">
                <div className="prose prose-invert mx-auto">
                  {extractedParagraphs.map((paragraph, index) => (
                    <p key={index} className="text-gray-200 mb-4 leading-relaxed text-sm">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  
    // If no content was found, show the original error message
    return (
      <div className="flex items-center justify-center h-full w-full bg-gray-900/90 rounded-lg border border-gray-800 shadow-lg">
        <div className="relative max-w-sm text-center px-8 py-8">
          <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-white text-sm font-medium mb-2">No Content Available</h3>
          <p className="text-gray-400 text-xs mb-4">
            We couldn&apos;t extract any preview content for this book. It may not be available in our database or may have restricted access.
          </p>
          
          {content && (content.title || content.author) && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <p className="text-gray-300 text-sm font-medium">{content.title || 'Unknown Title'}</p>
              {content.author && (
                <p className="text-gray-400 text-xs">by {content.author}</p>
              )}
            </div>
          )}
          
          <button
            onClick={() => window.location.href = '/'} 
            className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-colors duration-200"
          >
            Upload Different Book
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-hidden bg-gray-900 rounded-lg border border-gray-800 shadow-lg transition-all duration-300">
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-none p-5 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-white">{content.title}</h1>
              {content.author && (
                <p className="text-sm text-gray-400">by {content.author}</p>
              )}
            </div>
            
            <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
              (content.isNonFiction === true || content.fiction === false) 
                ? 'bg-purple-900/30 text-purple-300 border border-purple-800/50' 
                : 'bg-indigo-900/30 text-indigo-300 border border-indigo-800/50'
            }`}>
              {(content.isNonFiction === true || content.fiction === false) ? 'Non-Fiction' : 'Fiction'}
            </div>
          </div>
          
          <div className="flex space-x-1 mt-4">
            <button
              onClick={() => setCurrentPage('first')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                currentPage === 'first'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              First Page
            </button>
            <button
              onClick={() => setCurrentPage('second')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                currentPage === 'second'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Second Page
            </button>
          </div>
        </div>
        
        <div className={`flex-1 overflow-auto bg-gray-900 px-6 py-8 ${styles.customScrollbar}`}>
          <div className="max-w-2xl mx-auto">
            <div className="prose prose-invert mx-auto">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="text-gray-200 mb-4 leading-relaxed text-sm">
                  {paragraph}
                </p>
              ))}
              
              {paragraphs.length === 0 && (
                <p className="text-gray-400 italic text-center my-8">No content available for this page.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookContentDisplay;