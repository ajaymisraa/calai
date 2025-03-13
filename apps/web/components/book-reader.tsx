import React, { useState, useEffect } from 'react'
import { BookData } from '../types/book'

// Define types for book data
interface PageInsight {
  pageNumber: number
  contentType: string
  isFrontMatter: boolean
  isMainContent: boolean
  summary: string
}

// View options for the book reader
type ViewType = 'image' | 'text' | 'preview'

interface BookReaderProps {
  bookData: BookData
  error?: {
    type: string;
    message: string;
  }
}

export const BookReader: React.FC<BookReaderProps> = ({ bookData, error }) => {
  // State for the current page and view type
  const [currentPage, setCurrentPage] = useState(0)
  const [view, setView] = useState<ViewType>('image')
  
  // Get pages to display
  const pages = React.useMemo(() => {
    // Use Google Books preview pages if available
    if (bookData.googleBooksData?.previewPages && bookData.googleBooksData.previewPages.length > 0) {
      return bookData.googleBooksData.previewPages
    }
    
    // Fall back to other image sources
    if (bookData.previewImages && bookData.previewImages.length > 0) {
      return bookData.previewImages
    }
    
    if (bookData.sequentialPages?.imagePaths && bookData.sequentialPages.imagePaths.length > 0) {
      return bookData.sequentialPages.imagePaths
    }
    
    return []
  }, [bookData])
  
  // Get text content if available
  const textContent = React.useMemo(() => {
    // Use Google Books extracted text if available
    if (bookData.googleBooksData?.extractedPageText) {
      return bookData.googleBooksData.extractedPageText
    }
    
    // Fall back to OCR content
    if (
      bookData.sequentialPages?.ocrResults && 
      Array.isArray(bookData.sequentialPages.ocrResults) &&
      currentPage < bookData.sequentialPages.ocrResults.length
    ) {
      return bookData.sequentialPages.ocrResults[currentPage]?.text || 'No text available';
    }
    
    // Fall back to text array if available
    if (bookData.text && bookData.text.length > 0 && currentPage < bookData.text.length) {
      return bookData.text[currentPage]
    }
    
    return 'No text content available for this page.'
  }, [bookData, currentPage])
  
  // Set initial page to recommended start page if available
  useEffect(() => {
    if (bookData.recommendedStartPage && bookData.recommendedStartPage > 0) {
      setCurrentPage(bookData.recommendedStartPage - 1) // Convert from 1-indexed to 0-indexed
    }
  }, [bookData.recommendedStartPage])
  
  // Reset to page 0 when switching views
  useEffect(() => {
    setCurrentPage(0)
  }, [view])
  
  // Navigation functions
  const goToNextPage = () => {
    if (currentPage < pages.length - 1) {
      setCurrentPage(currentPage + 1)
    }
  }
  
  const goToPreviousPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1)
    }
  }
  
  // Check if Google Books preview is available
  const hasGooglePreview = bookData.googleBooksData?.viewability === 'PARTIAL' || 
                          bookData.googleBooksData?.viewability === 'ALL_PAGES'

  // Display a more friendly message if no content is available, but not as an error
  const hasNoContent = pages.length === 0;
  
  // Determine if navigation should be disabled
  const isFirstPage = currentPage === 0
  const isLastPage = currentPage === pages.length - 1

  // Only show error if backend explicitly returns an error
  if (error) {
    return (
      <div className="book-unavailable-error">
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <h2 className="text-xl font-semibold text-red-700 mb-2">Book Not Available</h2>
          <p className="text-red-600">
            {error.message || "This book is not available due to an error with our processing service."}
          </p>
          <p className="mt-2 text-gray-600">
            Please try searching for another book or contact support if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="book-reader">
      <div className="mb-4 flex flex-col space-y-2">
        <h1 className="text-2xl font-bold">{bookData.metadata.title}</h1>
        {bookData.metadata.author && (
          <p className="text-lg">by {bookData.metadata.author}</p>
        )}
        
        {/* View selector tabs - only show if we have content */}
        {!hasNoContent && (
          <div className="flex border-b mb-4">
            <button
              className={`px-4 py-2 ${view === 'image' ? 'border-b-2 border-blue-500 text-blue-500' : ''}`}
              onClick={() => setView('image')}
            >
              Image View
            </button>
            <button
              className={`px-4 py-2 ${view === 'text' ? 'border-b-2 border-blue-500 text-blue-500' : ''}`}
              onClick={() => setView('text')}
            >
              Text View
            </button>
            {hasGooglePreview && bookData.googleBooksData?.embedLink && (
              <button
                className={`px-4 py-2 ${view === 'preview' ? 'border-b-2 border-blue-500 text-blue-500' : ''}`}
                onClick={() => setView('preview')}
              >
                Google Preview
              </button>
            )}
          </div>
        )}
        
        {/* Google Books badge and link */}
        {bookData.googleBooksData && (
          <div className="flex items-center space-x-2 mb-2">
            {hasGooglePreview && (
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded">
                Google Preview Available
              </span>
            )}
            {bookData.googleBooksData.previewLink && (
              <a 
                href={bookData.googleBooksData.previewLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline text-sm"
              >
                View on Google Books
              </a>
            )}
          </div>
        )}
        
        {/* Content based on selected view */}
        <div className="content-container">
          {/* Message for no content instead of error */}
          {hasNoContent && (
            <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg">
              <h2 className="text-xl font-semibold text-gray-700 mb-2">No Preview Available</h2>
              <p className="text-gray-600">
                No preview content is available for this book at the moment. This book may not be in the Google Books preview program 
                or we don&apos;t have permission to display its content.
              </p>
              <p className="mt-2 text-gray-600">
                You can try searching for another book or check back later as our content library is frequently updated.
              </p>
            </div>
          )}

          {/* Image View */}
          {!hasNoContent && view === 'image' && (
            <div className="image-view">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">
                  Page {currentPage + 1} of {pages.length}
                </span>
              </div>
              
              <div className="max-w-xl mx-auto">
                {/* Using img with unoptimized to prevent Next.js warning while maintaining compatibility */}
                <img 
                  src={pages[currentPage]} 
                  alt={`Page ${currentPage + 1}`}
                  className="max-w-full rounded shadow"
                  loading="lazy"
                />
              </div>
            </div>
          )}
          
          {/* Text View */}
          {!hasNoContent && view === 'text' && (
            <div className="text-view bg-white p-4 rounded border max-h-[600px] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-sm">{textContent}</pre>
            </div>
          )}
          
          {/* Google Preview (Embedded) */}
          {view === 'preview' && bookData.googleBooksData?.embedLink && (
            <div className="google-preview-view">
              <iframe
                src={bookData.googleBooksData.embedLink}
                width="100%"
                height="600"
                allowFullScreen
                className="rounded border"
              ></iframe>
            </div>
          )}
        </div>
      </div>
      
      {/* Navigation controls - only show for image/text views, not for preview, and only if we have pages */}
      {!hasNoContent && view !== 'preview' && (
        <div className="flex justify-between mt-4">
          <button
            onClick={goToPreviousPage}
            disabled={isFirstPage}
            className={`px-4 py-2 bg-blue-500 text-white rounded ${
              isFirstPage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
            }`}
          >
            Previous Page
          </button>
          
          <span className="self-center">
            Page {currentPage + 1} of {pages.length}
          </span>
          
          <button
            onClick={goToNextPage}
            disabled={isLastPage}
            className={`px-4 py-2 bg-blue-500 text-white rounded ${
              isLastPage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
            }`}
          >
            Next Page
          </button>
        </div>
      )}
    </div>
  )
}

