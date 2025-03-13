import { NextApiRequest, NextApiResponse } from 'next'
import axios from 'axios'
import { BookData } from '../../../types/book'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Book ID is required' })
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  try {
    // Fetch book data from the processor service
    const processorUrl = process.env.PROCESSOR_API_URL || 'http://localhost:3001';
    const apiPath = process.env.PROCESSOR_API_PATH || '/api';
    console.log(`Fetching book data from processor at ${processorUrl}${apiPath}/books/${id}`);
    const response = await axios.get(`${processorUrl}${apiPath}/books/${id}`);
    
    // If successful, return the data from the processor
    if (response.status === 200) {
      const bookData: BookData = response.data;
      
      // Ensure metadata exists with at least the isBook flag
      if (!bookData.metadata) {
        bookData.metadata = {
          isBook: true,
        };
      }
      
      // Log the metadata we received from the processor
      console.log('Received book data from processor with metadata:', {
        title: bookData.metadata.title,
        author: bookData.metadata.author,
        isNonFiction: bookData.metadata.isNonFiction
      });
      
      // Return the complete book data including title and author from the processor
      return res.status(200).json(bookData);
    } else {
      throw new Error(`Received status ${response.status} from processor service`);
    }
  } catch (error) {
    console.error('Error fetching book data:', error);
    
    // For development/fallback purposes only - using mock data when the processor is unavailable
    if (process.env.NODE_ENV === 'development') {
      console.warn('Using mock data as fallback. This should only be used during development.');
      const mockBookData: BookData = {
        metadata: {
          isBook: true,
          title: `Sample Book ${id}`,
          author: 'Sample Author',
          description: 'This is a sample book description.',
          confidence: 0.95,
          isNonFiction: id === '2', // Make books with even IDs non-fiction, odd IDs fiction
        },
        text: [
          'This is the text content of the first page.',
          'This is the text content of the second page.',
          'This is the text content of the third page.',
        ],
        imageUrls: [
          'https://via.placeholder.com/300x450?text=Book+Cover',
          'https://via.placeholder.com/600x800?text=Page+1',
          'https://via.placeholder.com/600x800?text=Page+2',
        ],
        source: 'API Mock Data (Fallback)',
        previewImages: [
          'https://via.placeholder.com/600x800?text=Preview+1',
          'https://via.placeholder.com/600x800?text=Preview+2',
          'https://via.placeholder.com/600x800?text=Preview+3',
        ],
        coverImage: 'https://via.placeholder.com/300x450?text=Book+Cover',
        sequentialPages: {
          imagePaths: [
            'https://via.placeholder.com/600x800?text=Sequential+1',
            'https://via.placeholder.com/600x800?text=Sequential+2',
            'https://via.placeholder.com/600x800?text=Sequential+3',
          ],
          ocrResults: [
            {
              text: 'This is OCR text from page 1.',
              imagePath: 'https://via.placeholder.com/600x800?text=Sequential+1',
              confidence: 0.85,
            },
            {
              text: 'This is OCR text from page 2.',
              imagePath: 'https://via.placeholder.com/600x800?text=Sequential+2',
              confidence: 0.82,
            },
            {
              text: 'This is OCR text from page 3.',
              imagePath: 'https://via.placeholder.com/600x800?text=Sequential+3',
              confidence: 0.79,
            },
          ],
        },
        contentAnalysis: {
          frontMatterPages: 2,
          firstContentPage: 3,
          isNonFiction: id === '2', // Same as metadata
          contentInsights: 'This book contains mostly text with some diagrams. The first two pages are front matter including a table of contents.',
        },
        recommendedStartPage: 3,
        // Include Google Books data in the mock response
        googleBooksData: {
          id: `google-book-${id}`,
          previewLink: `https://books.google.com/books?id=google-book-${id}`,
          webReaderLink: `https://books.google.com/books?id=google-book-${id}&printsec=frontcover&source=gbs_ge_summary_r&cad=0#v=onepage&q&f=false`,
          embedLink: `https://books.google.com/books?id=google-book-${id}&lpg=PP1&pg=PP1&output=embed`,
          viewability: 'PARTIAL', // Mock that most books have partial preview
          embeddable: true,
          extractedPageText: 'This is sample extracted text from the Google Books preview. It represents what would be extracted using Puppeteer in a real implementation.',
          previewPages: [
            // Simulating downloaded preview pages
            'https://via.placeholder.com/600x800?text=Google+Preview+1',
            'https://via.placeholder.com/600x800?text=Google+Preview+2',
            'https://via.placeholder.com/600x800?text=Google+Preview+3',
            'https://via.placeholder.com/600x800?text=Google+Preview+4',
            'https://via.placeholder.com/600x800?text=Google+Preview+5',
          ]
        }
      }
      
      return res.status(200).json(mockBookData);
    }
    
    return res.status(500).json({ error: 'Failed to fetch book data' });
  }
} 