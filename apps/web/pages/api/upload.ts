import { NextApiRequest, NextApiResponse } from 'next';
import { formidable, Fields, Files } from 'formidable';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Disable body parser for file upload
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const { fields, files } = await parseForm(req);
    
    if (!files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!file || !file.filepath) {
      return res.status(400).json({ error: 'Invalid file upload' });
    }
    
    // Generate a unique book ID
    const bookId = uuidv4();
    
    // For Vercel serverless environment, we need to use the /tmp directory
    // which is the only writable directory in the serverless environment
    const isVercel = process.env.VERCEL === '1';
    
    // Create a temporary directory for the upload
    const uploadDir = isVercel
      ? path.join('/tmp', 'uploads')
      : path.join(process.cwd(), 'public', 'uploads');
      
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Create the image URL (either from temporary file or using the original path)
    const fileName = `${bookId}${path.extname(file.originalFilename || 'image.jpg')}`;
    const imagePath = path.join(uploadDir, fileName);
    
    // Copy the file to our uploads directory
    fs.copyFileSync(file.filepath, imagePath);
    
    // In Vercel, we'll just pass the uploaded file directly to the processor
    // because we can't serve static files from /tmp
    // Instead of generating a URL, we'll use Base64 encoding to pass the image data
    let imageUrl = '';
    
    if (isVercel) {
      // Read the file as binary data
      const imageBuffer = fs.readFileSync(imagePath);
      // Convert to Base64
      const base64Image = imageBuffer.toString('base64');
      // Create a data URL
      imageUrl = `data:image/jpeg;base64,${base64Image}`;
    } else {
      // For local development, use the traditional URL approach
      imageUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/uploads/${fileName}`;
    }
    
    // Process the image with the processor service
    const processorApiUrl = process.env.PROCESSOR_API_URL || 'http://localhost:3002';
    
    // Use the processor API URL directly without adding /api
    const baseUrl = processorApiUrl;
    
    // Immediately return the book ID without waiting for processing
    const bookResponse = {
      isBook: true,
      bookId: bookId,
      imageUrl,
      message: "Book processing started. Content will appear shortly."
    };
    
    // Start processing in the background
    processBookInBackground(imageUrl, bookId, baseUrl);
    
    return res.status(200).json(bookResponse);
  } catch (error: any) {
    console.error('Error processing upload:', error);
    
    // If we got a response from the processor service, pass it through
    if (error.response) {
      return res.status(error.response.status || 500).json(error.response.data || { error: 'Error processing image' });
    }
    
    return res.status(500).json({ error: 'Error processing upload' });
  }
}

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      keepExtensions: true,
      maxFiles: 1,
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });
    
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      }
      resolve({ fields, files });
    });
  });
}

/**
 * Process the book in the background without blocking the response
 */
async function processBookInBackground(imageUrl: string, bookId: string, baseUrl: string) {
  try {
    // Process the image with the processor service
    console.log(`Starting background processing for book ${bookId}`);
    
    // Store initial book info to help with error handling and service unavailability
    try {
      // Create a metadata file with the book ID to help with error recovery
      const isVercel = process.env.VERCEL === '1';
      const metaDir = isVercel 
        ? path.join('/tmp', 'uploads') 
        : path.join(process.cwd(), 'public', 'uploads');
        
      if (!fs.existsSync(metaDir)) {
        fs.mkdirSync(metaDir, { recursive: true });
      }
      
      const metaFilePath = path.join(metaDir, `${bookId}.meta.json`);
      fs.writeFileSync(metaFilePath, JSON.stringify({
        bookId,
        imageUrl,
        uploadTime: new Date().toISOString(),
        processingStarted: true,
        processingComplete: false
      }));
    } catch (metaError) {
      console.error('Error saving book metadata:', metaError);
    }
    
    const response = await axios.post(`${baseUrl}/process-book`, {
      imageUrl,
      bookId
    }, {
      timeout: 300000 // 5 minutes timeout
    });
    
    console.log(`Background processing complete for book ${bookId}, status: ${response.status}`);
    
    // Extract book metadata from the response if available
    const bookMetadata = response.data?.metadata || {};
    const bookTitle = bookMetadata.title || response.data?.title || 'Unknown Book';
    const bookAuthor = bookMetadata.author || response.data?.author || 'Unknown Author';
    const isNonFiction = bookMetadata.isNonFiction;
    
    // Check the processing result for errors
    if (response.data && response.data.status === 'error') {
      console.error(`Book processing completed with error: ${response.data.error?.message || 'Unknown error'}`);
      
      // Determine if this is a specific error about the image not being a book
      const isNotBookError = 
        response.data.error?.code === 'PROCESSING_ERROR' || 
        (response.data.error?.message && (
          response.data.error.message.includes('not appear to be a book') || 
          response.data.error.message.includes('not a book cover') ||
          response.data.error.message.includes('invalid image')
        ));
      
      // Save error information for future reference
      try {
        const isVercel = process.env.VERCEL === '1';
        const metaDir = isVercel 
          ? path.join('/tmp', 'uploads') 
          : path.join(process.cwd(), 'public', 'uploads');
        
        if (!fs.existsSync(metaDir)) {
          fs.mkdirSync(metaDir, { recursive: true });
        }
        
        const metaFilePath = path.join(metaDir, `${bookId}.meta.json`);
        fs.writeFileSync(metaFilePath, JSON.stringify({
          bookId,
          imageUrl,
          title: bookTitle,
          author: bookAuthor,
          isNonFiction,
          uploadTime: new Date().toISOString(),
          error: {
            message: response.data.error?.message || 'Unknown error',
            code: isNotBookError ? 'PROCESSING_ERROR' : (response.data.error?.code || 'UNKNOWN_ERROR')
          },
          processingComplete: true,
          processingSuccess: false
        }));
      } catch (metaError) {
        console.error('Error saving book error metadata:', metaError);
      }
      
    } else if (response.data && !response.data.isAvailable) {
      console.error(`Book processing completed but content is not available`);
      
      // Save partial information for future reference
      try {
        const isVercel = process.env.VERCEL === '1';
        const metaDir = isVercel 
          ? path.join('/tmp', 'uploads') 
          : path.join(process.cwd(), 'public', 'uploads');
          
        if (!fs.existsSync(metaDir)) {
          fs.mkdirSync(metaDir, { recursive: true });
        }
        
        const metaFilePath = path.join(metaDir, `${bookId}.meta.json`);
        fs.writeFileSync(metaFilePath, JSON.stringify({
          bookId,
          imageUrl,
          title: bookTitle,
          author: bookAuthor,
          isNonFiction,
          uploadTime: new Date().toISOString(),
          processingComplete: true,
          processingSuccess: false,
          isAvailable: false
        }));
      } catch (metaError) {
        console.error('Error saving unavailable book metadata:', metaError);
      }
    } else if (response.data) {
      // Save successful processing information
      try {
        const isVercel = process.env.VERCEL === '1';
        const metaDir = isVercel 
          ? path.join('/tmp', 'uploads') 
          : path.join(process.cwd(), 'public', 'uploads');
          
        if (!fs.existsSync(metaDir)) {
          fs.mkdirSync(metaDir, { recursive: true });
        }
        
        const metaFilePath = path.join(metaDir, `${bookId}.meta.json`);
        fs.writeFileSync(metaFilePath, JSON.stringify({
          bookId,
          imageUrl,
          title: bookTitle,
          author: bookAuthor,
          isNonFiction,
          uploadTime: new Date().toISOString(),
          processingComplete: true,
          processingSuccess: true
        }));
      } catch (metaError) {
        console.error('Error saving successful book metadata:', metaError);
      }
    }
    
    // Optional: Check book availability after processing
    try {
      // Short delay to ensure all status updates are saved
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await axios.get(`${baseUrl}/book-status/${bookId}`, {
        timeout: 10000
      });
      
      if (statusResponse.data && statusResponse.data.status === 'error') {
        console.error(`Book status check found error: ${statusResponse.data.error?.message || 'Unknown error'}`);
        
        // Update metadata with the error information
        try {
          const metaFilePath = path.join(process.cwd(), 'public', 'uploads', `${bookId}.meta.json`);
          const metaData = {
            bookId,
            imageUrl,
            title: statusResponse.data.title || bookTitle,
            author: statusResponse.data.author || bookAuthor,
            isNonFiction,
            uploadTime: new Date().toISOString(),
            processingComplete: true,
            processingSuccess: false,
            error: statusResponse.data.error,
            isAvailable: false
          };
          fs.writeFileSync(metaFilePath, JSON.stringify(metaData));
        } catch (metaError) {
          console.error('Error updating book metadata with status error:', metaError);
        }
      }
    } catch (statusError) {
      console.error(`Error checking book status after processing: ${statusError}`);
    }
  } catch (error: any) {
    console.error(`Background processing failed for book ${bookId}:`, error);
    
    // Extract error information
    const errorMessage = error.response?.data?.error 
      ? error.response.data.error 
      : (error.message || 'Unknown error');
    
    console.error(`Processing error details: ${errorMessage}`);
    
    // Determine if this is a specific error about the image not being a book
    const isNotBookError = 
      errorMessage.code === 'PROCESSING_ERROR' || 
      (typeof errorMessage === 'string' && (
        errorMessage.includes('not appear to be a book') || 
        errorMessage.includes('not a book cover') ||
        errorMessage.includes('invalid image')
      )) ||
      (typeof errorMessage === 'object' && errorMessage.message && (
        errorMessage.message.includes('not appear to be a book') ||
        errorMessage.message.includes('not a book cover') ||
        errorMessage.message.includes('invalid image')
      ));
    
    // Save error information
    try {
      const isVercel = process.env.VERCEL === '1';
      const metaDir = isVercel 
        ? path.join('/tmp', 'uploads') 
        : path.join(process.cwd(), 'public', 'uploads');
        
      if (!fs.existsSync(metaDir)) {
        fs.mkdirSync(metaDir, { recursive: true });
      }
      
      const metaFilePath = path.join(metaDir, `${bookId}.meta.json`);
      fs.writeFileSync(metaFilePath, JSON.stringify({
        bookId,
        imageUrl,
        uploadTime: new Date().toISOString(),
        processingComplete: false,
        processingSuccess: false,
        error: {
          message: typeof errorMessage === 'string' 
            ? errorMessage 
            : (errorMessage.message || 'Unknown error'),
          code: isNotBookError ? 'PROCESSING_ERROR' : 'SERVICE_ERROR'
        }
      }));
    } catch (metaError) {
      console.error('Error saving processing error metadata:', metaError);
    }
    
    // If we have access to the processor API endpoint, try to record the error status
    try {
      await axios.post(`${baseUrl}/record-error`, {
        bookId,
        error: {
          message: typeof errorMessage === 'string' 
            ? errorMessage 
            : (errorMessage.message || 'Unknown error'),
          code: isNotBookError ? 'PROCESSING_ERROR' : 'SERVICE_ERROR'
        }
      }).catch(() => console.error('Could not record error status'));
    } catch (recordError) {
      console.error('Error recording book processing error:', recordError);
    }
  }
} 