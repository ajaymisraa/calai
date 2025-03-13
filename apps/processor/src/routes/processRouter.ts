import { Router } from 'express';
import { processBookImage } from '../controllers/processController';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';

const router = Router();

// Route to process a book image
router.post('/process-book', processBookImage);

// Route to get a book by ID
router.get('/books/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Security: Sanitize the bookId to prevent directory traversal
    const sanitizedBookId = id.replace(/[^a-zA-Z0-9-_]/g, '_');
    
    // Path to book directory in cache
    let bookDir = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId);
    
    // Check if the book directory exists
    if (!fsSync.existsSync(bookDir)) {
      // If not found, check if an ID mapping file exists in other directories
      const bookDirs = fsSync.readdirSync(path.join(process.cwd(), 'cache', 'book-images'));
      
      // Look for a mapping file that points to our UUID
      let foundMapping = false;
      for (const dir of bookDirs) {
        const dirMappingPath = path.join(process.cwd(), 'cache', 'book-images', dir, 'id_mapping.json');
        
        if (fsSync.existsSync(dirMappingPath)) {
          try {
            const dirMappingData = await fs.readFile(dirMappingPath, 'utf8');
            const dirMapping = JSON.parse(dirMappingData);
            
            if (dirMapping.originalId === sanitizedBookId) {
              // Found a directory that maps to our UUID
              bookDir = path.join(process.cwd(), 'cache', 'book-images', dir);
              foundMapping = true;
              break;
            }
          } catch (e) {
            // Ignore errors reading/parsing mapping files
          }
        }
      }
      
      // If still not found after all attempts, return 404
      if (!foundMapping && !fsSync.existsSync(bookDir)) {
        return res.status(404).json({ error: 'Book not found' });
      }
    }
    
    // Look for metadata file - this contains the initial book detection data
    const metadataPath = path.join(bookDir, 'metadata.json');
    let title = '';
    let author = '';
    let isNonFiction = false;
    let confidence = 0.95; // Default confidence
    
    // First priority: Get metadata from the initial book detection (metadata.json)
    if (fsSync.existsSync(metadataPath)) {
      console.log(`Found metadata file at ${metadataPath}`);
      const metadataData = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataData);
      
      // Preserve the original book detection data
      title = metadata.title || '';
      author = metadata.author || '';
      
      // Explicitly check for isNonFiction and respect the original value
      if (typeof metadata.isNonFiction === 'boolean') {
        isNonFiction = metadata.isNonFiction;
        console.log(`Using isNonFiction=${isNonFiction} from initial book detection`);
      }
      
      // If confidence is available in metadata, use it
      if (typeof metadata.confidence === 'number') {
        confidence = metadata.confidence;
      }
    } else {
      console.log(`No metadata file found at ${metadataPath}`);
    }
    
    // Look for content analysis file
    const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
    let contentAnalysis = null;
    
    if (fsSync.existsSync(contentAnalysisPath)) {
      const contentAnalysisData = await fs.readFile(contentAnalysisPath, 'utf8');
      contentAnalysis = JSON.parse(contentAnalysisData);
    }
    
    // Get list of image files in the book directory
    const files = await fs.readdir(bookDir);
    const imageFiles = files.filter(file => 
      file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
    );
    
    // Prepare the response
    const bookData = {
      metadata: {
        isBook: true,
        title,
        author,
        isNonFiction,  // This comes from the initial detection
        confidence,
      },
      text: contentAnalysis ? [contentAnalysis.first_page, contentAnalysis.second_page] : [],
      imageUrls: imageFiles.map(file => `/api/book-images/${file}`),
      source: 'Processor Service',
      previewImages: imageFiles.map(file => `/api/book-images/${file}`),
      coverImage: imageFiles.length > 0 ? `/api/book-images/${imageFiles[0]}` : null,
      contentAnalysis: contentAnalysis ? {
        frontMatterPages: 1,
        firstContentPage: 2,
        isNonFiction, // Use the same value from initial detection
        contentInsights: 'Content analysis from processor service',
      } : null,
      recommendedStartPage: 1,
    };
    
    console.log(`Sending book data with title "${title}", author "${author}", isNonFiction=${isNonFiction}`);
    res.status(200).json(bookData);
  } catch (error) {
    console.error('Error retrieving book data:', error);
    res.status(500).json({ error: 'Error retrieving book data' });
  }
});

// Route to get analyzed book content for display in frontend
router.get('/content-analysis/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    
    // Security: Sanitize the bookId to prevent directory traversal
    const sanitizedBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
    
    // Path to book directory in cache
    let bookDir = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId);
    let contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
    
    // Check if content analysis exists at the direct path
    if (!fsSync.existsSync(contentAnalysisPath)) {
      // If not found, check if an ID mapping file exists
      const mappingPath = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId, 'id_mapping.json');
      
      if (fsSync.existsSync(mappingPath)) {
        // Read the mapping file to get the Google Books ID
        const mappingData = await fs.readFile(mappingPath, 'utf8');
        const mapping = JSON.parse(mappingData);
        
        if (mapping.googleBooksId) {
          // Try with the Google Books ID instead
          bookDir = path.join(process.cwd(), 'cache', 'book-images', mapping.googleBooksId);
          contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
        }
      }
      
      // If still not found, try looking through all directories to find a mapping back to this UUID
      if (!fsSync.existsSync(contentAnalysisPath)) {
        // Get all book directories
        const bookDirs = fsSync.readdirSync(path.join(process.cwd(), 'cache', 'book-images'));
        
        // Look for a mapping file that points to our UUID
        for (const dir of bookDirs) {
          const dirMappingPath = path.join(process.cwd(), 'cache', 'book-images', dir, 'id_mapping.json');
          
          if (fsSync.existsSync(dirMappingPath)) {
            try {
              const dirMappingData = await fs.readFile(dirMappingPath, 'utf8');
              const dirMapping = JSON.parse(dirMappingData);
              
              if (dirMapping.originalId === sanitizedBookId) {
                // Found a directory that maps to our UUID
                bookDir = path.join(process.cwd(), 'cache', 'book-images', dir);
                contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
                break;
              }
            } catch (e) {
              // Ignore errors reading/parsing mapping files
            }
          }
        }
      }
      
      // If still not found after all attempts, return 404
      if (!fsSync.existsSync(contentAnalysisPath)) {
        return res.status(404).json({ error: 'Content analysis not found' });
      }
    }
    
    // Read the content analysis file
    const contentAnalysisData = await fs.readFile(contentAnalysisPath, 'utf8');
    let contentAnalysis = JSON.parse(contentAnalysisData);
    
    // Check if we need to fix missing or invalid content
    const needsContentFix = 
      !contentAnalysis.first_page || 
      !contentAnalysis.second_page || 
      contentAnalysis.first_page.length < 50 ||
      contentAnalysis.second_page.length < 50 ||
      contentAnalysis.first_page.includes("Error extracting content") ||
      contentAnalysis.second_page.includes("Error extracting content");
    
    // If content needs fixing and OCR results exist, try to fix it now
    if (needsContentFix) {
      const ocrFilePath = path.join(bookDir, 'ocr_results.json');
      
      if (fsSync.existsSync(ocrFilePath)) {
        console.log(`Content analysis for ${sanitizedBookId} needs fixing and OCR results exist`);
        
        try {
          // Import the cleanBookContentPages function
          const { cleanBookContentPages } = await import('../services/bookService');
          
          // Try to clean the content
          await cleanBookContentPages(sanitizedBookId);
          
          // Read the updated content analysis
          const updatedData = await fs.readFile(contentAnalysisPath, 'utf8');
          contentAnalysis = JSON.parse(updatedData);
          
          console.log(`Successfully fixed content analysis for ${sanitizedBookId}`);
        } catch (fixError) {
          console.error(`Error fixing content analysis for ${sanitizedBookId}:`, fixError);
          // Continue with original content analysis, we'll do our best
        }
      } else {
        console.log(`Content analysis needs fixing but no OCR results found for ${sanitizedBookId}`);
      }
    }
    
    // Use values from content_analysis.json if they exist,
    // otherwise fallback to the metadata file
    let title = contentAnalysis.title || '';
    let author = contentAnalysis.author || '';
    // For fiction field: false = non-fiction, true = fiction
    // Need to convert to isNonFiction which is true = non-fiction, false = fiction
    let isNonFiction = typeof contentAnalysis.fiction === 'boolean' ? !contentAnalysis.fiction : false;
    
    // Only look for metadata if the values weren't in content_analysis.json
    if (!title || !author) {
      // Look for metadata file if it exists
      const metadataPath = path.join(bookDir, 'metadata.json');
      
      if (fsSync.existsSync(metadataPath)) {
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataData);
        // Only use metadata if not found in content_analysis.json
        title = title || metadata.title || '';
        author = author || metadata.author || '';
        // Only use metadata non-fiction value if not specified in content_analysis
        if (typeof contentAnalysis.fiction !== 'boolean' && typeof metadata.isNonFiction === 'boolean') {
          isNonFiction = metadata.isNonFiction;
        }
      }
    }
    
    // If isNonFiction is still not determined, try to determine from content
    if (typeof contentAnalysis.fiction !== 'boolean' && typeof isNonFiction !== 'boolean') {
      // Simple heuristic: check if the content contains chapter indicators and narrative content
      const firstPage = contentAnalysis.first_page?.toLowerCase() || '';
      isNonFiction = 
        firstPage.includes('introduction') || 
        firstPage.includes('foreword') || 
        firstPage.includes('preface') ||
        (firstPage.includes('chapter') && 
         (firstPage.includes('theory') || 
          firstPage.includes('analysis') || 
          firstPage.includes('study')));
    }
    
    console.log(`Sending content analysis: title="${title}", author="${author}", isNonFiction=${isNonFiction}`);
    
    // Ensure we have valid content - use placeholders if needed
    const firstPage = contentAnalysis.first_page || 'Content unavailable for first page';
    const secondPage = contentAnalysis.second_page || 'Content unavailable for second page';
    
    // Determine which content to display based on fiction/non-fiction status
    let recommendedContent = '';
    
    // Select the appropriate content based on fiction status
    if (!isNonFiction) {
      // For fiction: return the second page
      recommendedContent = secondPage;
    } else {
      // For non-fiction: return the first page
      recommendedContent = firstPage;
    }
    
    // Return the processed data with all options
    // Include both the original field names and the expected field names for frontend compatibility
    res.status(200).json({
      isNonFiction,
      firstPageContent: firstPage,
      secondPageContent: secondPage,
      // Also include the original field names from content_analysis.json
      first_page: firstPage,
      second_page: secondPage,
      fiction: !isNonFiction, // reversed from isNonFiction
      recommendedContent,
      title,
      author
    });
    
  } catch (error) {
    console.error('Error retrieving content analysis:', error);
    res.status(500).json({ error: 'Error retrieving content analysis' });
  }
});

// Route to get the processing status of a book
router.get('/book-status/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    
    // Security: Sanitize the bookId to prevent directory traversal
    const sanitizedBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
    
    // Path to book directory in cache
    const bookDir = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId);
    
    // Check for status file first (most accurate and up-to-date status)
    const statusFilePath = path.join(bookDir, 'status.json');
    
    // Check if the directory exists
    if (!fsSync.existsSync(bookDir)) {
      // Try to look for ID mapping in case the Google Books ID is different
      const originalDir = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId);
      const mappingPath = path.join(originalDir, 'id_mapping.json');
      
      if (fsSync.existsSync(mappingPath)) {
        // Read the mapping file to get the Google Books ID
        const mappingData = await fs.readFile(mappingPath, 'utf8');
        const mapping = JSON.parse(mappingData);
        
        if (mapping.googleBooksId) {
          // Redirect to the Google Books ID status
          const redirectUrl = `/api/book-status/${mapping.googleBooksId}`;
          console.log(`Redirecting book status to Google Books ID: ${mapping.googleBooksId}`);
          res.redirect(307, redirectUrl);
          return;
        }
      }
      
      // If not found and no redirect, return "processing" state
      console.log(`Book directory not found for ID: ${sanitizedBookId}`);
      return res.status(404).json({
        bookId: sanitizedBookId,
        status: 'processing',
        message: 'Book processing has not been completed yet.'
      });
    }
    
    // Check for error flags first
    const errorFilePath = path.join(bookDir, 'error.json');
    if (fsSync.existsSync(errorFilePath)) {
      const errorData = await fs.readFile(errorFilePath, 'utf8');
      const error = JSON.parse(errorData);
      
      console.log(`Found error.json for book ${sanitizedBookId}:`, error);
      
      // Look for metadata.json to include book details with the error
      let title = 'Unknown Book';
      let author = 'Unknown Author';
      
      const metadataPath = path.join(bookDir, 'metadata.json');
      if (fsSync.existsSync(metadataPath)) {
        try {
          const metadataData = await fs.readFile(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataData);
          title = metadata.title || title;
          author = metadata.author || author;
        } catch (metadataError) {
          console.error('Error reading metadata:', metadataError);
        }
      }
      
      return res.status(200).json({
        bookId: sanitizedBookId,
        status: 'error',
        title,
        author,
        error: {
          message: error.message || 'An error occurred during book processing.',
          code: error.code || 'PROCESSING_ERROR'
        }
      });
    }
    
    // Check if the status.json file exists
    if (fsSync.existsSync(statusFilePath)) {
      const statusData = await fs.readFile(statusFilePath, 'utf8');
      const status = JSON.parse(statusData);
      
      console.log(`Found status.json for book ${sanitizedBookId}:`, status);
      
      return res.status(200).json({
        bookId: sanitizedBookId,
        ...status
      });
    }
    
    // Check for content_analysis.json
    const contentAnalysisPath = path.join(bookDir, 'content_analysis.json');
    if (fsSync.existsSync(contentAnalysisPath)) {
      // If we have content analysis but no explicit status, consider it complete
      // But first check for viewability in case it's NO_PAGES
      const googleBooksPath = path.join(bookDir, 'google_books.json');
      if (fsSync.existsSync(googleBooksPath)) {
        try {
          const googleBooksData = await fs.readFile(googleBooksPath, 'utf8');
          const googleBooks = JSON.parse(googleBooksData);
          
          if (googleBooks.viewability === 'NO_PAGES') {
            // Book exists but has no preview available
            let title = 'Unknown Book';
            let author = 'Unknown Author';
            
            const metadataPath = path.join(bookDir, 'metadata.json');
            if (fsSync.existsSync(metadataPath)) {
              try {
                const metadataData = await fs.readFile(metadataPath, 'utf8');
                const metadata = JSON.parse(metadataData);
                title = metadata.title || title;
                author = metadata.author || author;
              } catch (metadataError) {
                console.error('Error reading metadata:', metadataError);
              }
            }
            
            return res.status(200).json({
              bookId: sanitizedBookId,
              status: 'error',
              title,
              author,
              error: {
                message: `We couldn't find "${title}" by ${author} in our preview database.`,
                code: 'NO_PAGES_AVAILABLE'
              }
            });
          }
        } catch (googleBooksError) {
          console.error('Error reading Google Books data:', googleBooksError);
        }
      }
      
      // If we get here, we have content and no NO_PAGES error
      return res.status(200).json({
        bookId: sanitizedBookId,
        status: 'complete'
      });
    }
    
    // If we have a logs.txt file but nothing else, it's still processing
    const logsPath = path.join(bookDir, 'logs.txt');
    if (fsSync.existsSync(logsPath)) {
      try {
        const logsData = await fs.readFile(logsPath, 'utf8');
        
        // Check if logs indicate NO_PAGES viewability
        if (logsData.includes('Book has NO_PAGES viewability') || 
            logsData.includes('BOOK_NOT_AVAILABLE')) {
          // Extract book details from logs if possible
          let title = 'Unknown Book';
          let author = 'Unknown Author';
          
          // Try to extract title and author from logs
          const titleMatch = logsData.match(/title="([^"]+)"/);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1];
          }
          
          const authorMatch = logsData.match(/author="([^"]+)"/);
          if (authorMatch && authorMatch[1]) {
            author = authorMatch[1];
          }
          
          return res.status(200).json({
            bookId: sanitizedBookId,
            status: 'error',
            title,
            author,
            error: {
              message: `We couldn't find "${title}" by ${author} in our preview database.`,
              code: 'NO_PAGES_AVAILABLE'
            }
          });
        }
        
        // Check for errors in logs
        if (logsData.includes('ERROR IN BOOK CONTENT PROCESSING') || 
            logsData.includes('API_REQUEST_ERROR')) {
          return res.status(200).json({
            bookId: sanitizedBookId,
            status: 'error',
            error: {
              message: 'An error occurred during book processing.',
              code: 'PROCESSING_ERROR'
            }
          });
        }
      } catch (logsError) {
        console.error('Error reading logs:', logsError);
      }
      
      // If we have logs but no error indicators, it's still processing
      return res.status(200).json({
        bookId: sanitizedBookId,
        status: 'processing',
        message: 'Book is still being processed.'
      });
    }
    
    // Default response if we can't determine the status
    return res.status(200).json({
      bookId: sanitizedBookId,
      status: 'unknown',
      message: 'Book status could not be determined.'
    });
  } catch (error) {
    console.error('Error fetching book status:', error);
    res.status(500).json({ 
      error: 'Failed to get book status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Record error information for a book
router.post('/record-error', async (req, res) => {
  try {
    const { bookId, error } = req.body;
    
    if (!bookId) {
      return res.status(400).json({ error: 'Book ID is required' });
    }
    
    if (!error || typeof error !== 'object') {
      return res.status(400).json({ error: 'Error information is required' });
    }
    
    // Ensure error has the correct format
    const errorInfo = {
      message: error.message || 'Unknown error',
      code: error.code || 'PROCESSING_ERROR',
      timestamp: new Date().toISOString()
    };
    
    // Sanitize the bookId for safety
    const sanitizedBookId = bookId.replace(/[^a-zA-Z0-9-_]/g, '_');
    
    // Create the book directory if it doesn't exist
    const bookDir = path.join(process.cwd(), 'cache', 'book-images', sanitizedBookId);
    if (!fsSync.existsSync(bookDir)) {
      fsSync.mkdirSync(bookDir, { recursive: true });
    }
    
    // Write the error information to error.json
    const errorPath = path.join(bookDir, 'error.json');
    await fs.writeFile(errorPath, JSON.stringify(errorInfo, null, 2));
    
    // Create a status.json file as well
    const statusPath = path.join(bookDir, 'status.json');
    await fs.writeFile(statusPath, JSON.stringify({
      status: 'error',
      error: errorInfo,
      lastUpdated: new Date().toISOString()
    }, null, 2));
    
    // Log the error
    console.log(`Recorded error for book ${sanitizedBookId}: ${errorInfo.message}`);
    
    // Success response
    res.status(200).json({ 
      success: true, 
      message: 'Error information recorded'
    });
  } catch (error) {
    console.error('Error recording book error information:', error);
    res.status(500).json({ 
      error: 'Failed to record error information',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Serve cached book preview images using temporary files
router.get('/book-images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security: Sanitize the filename to prevent directory traversal attacks
    const sanitizedFilename = path.basename(filename);
    
    // Get the absolute path to the permanent cache directory
    const permanentCachePath = path.join(process.cwd(), 'cache', 'book-images', sanitizedFilename);
    
    // Create a temporary file path in /tmp directory
    const tmpFilePath = path.join('/tmp', sanitizedFilename);
    
    // Check if the original file exists
    if (!fsSync.existsSync(permanentCachePath)) {
      console.error(`Image file not found: ${permanentCachePath}`);
      return res.status(404).json({ error: 'Image not found' });
    }
    
    try {
      // Copy the file from permanent storage to temporary storage
      await fs.copyFile(permanentCachePath, tmpFilePath);
      
      // Read from the temporary file
      const data = await fs.readFile(tmpFilePath);
      
      // Set appropriate content type for PNG images
      res.set('Content-Type', 'image/png');
      
      // Send the file data
      res.send(data);
      
      // Clean up the temporary file after sending the response
      await fs.unlink(tmpFilePath).catch(err => {
        console.error(`Error cleaning up temporary file ${tmpFilePath}:`, err);
      });
    } catch (error) {
      console.error('Error handling file:', error);
      res.status(500).json({ error: 'Error processing image file' });
    }
  } catch (error) {
    console.error('Error serving book image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as processRouter }; 