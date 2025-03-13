import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { BookData } from '../../types/book';
import { BookReader } from '../../components/book-reader';


// ignore this comment 
export default function BookPage() {
  const router = useRouter();
  const { id } = router.query;
  
  const [loading, setLoading] = useState(true);
  const [bookData, setBookData] = useState<BookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    // Only fetch when we have an ID
    if (!id) return;
    
    async function fetchBookData() {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/books/${id}`);
        
        if (!response.ok) {
          throw new Error(`Error fetching book data: ${response.statusText}`);
        }
        
        const data = await response.json();
        setBookData(data);
      } catch (err) {
        console.error('Error fetching book:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    }
    
    fetchBookData();
  }, [id]);
  
  // Show loading state
  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        <p className="ml-4 text-lg text-gray-700">Loading book data...</p>
      </div>
    );
  }
  
  // Show error state
  if (error) {
    return (
      <div className="flex flex-col justify-center items-center h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>Error: {error}</p>
        </div>
        <button 
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go Back
        </button>
      </div>
    );
  }
  
  // Show 'book not found' state
  if (!bookData) {
    return (
      <div className="flex flex-col justify-center items-center h-screen">
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          <p>Book not found</p>
        </div>
        <button 
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go Back
        </button>
      </div>
    );
  }
  
  // Show book data
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <button 
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
        >
          ← Back to Home
        </button>
      </div>
      
      <div className="bg-white rounded-lg shadow-lg p-6">
        <BookReader bookData={bookData} />
      </div>
      
      {/* Book Source Info */}
      {bookData.source && (
        <div className="mt-6 bg-blue-50 p-4 rounded">
          <h3 className="text-lg font-medium text-blue-800 mb-2">Source Information</h3>
          <p className="text-blue-700">{bookData.source}</p>
          
          {bookData.metadata.confidence && (
            <p className="mt-2 text-sm text-blue-600">
              Identification confidence: {Math.round(bookData.metadata.confidence * 100)}%
            </p>
          )}
        </div>
      )}
      
      {/* Technical Details (for debugging) */}
      <div className="mt-8 text-xs text-gray-500">
        <p>Book ID: {id}</p>
        {bookData.googleBooksData?.id && (
          <p>Google Books ID: {bookData.googleBooksData.id}</p>
        )}
      </div>
    </div>
  );
} 