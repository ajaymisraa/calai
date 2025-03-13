'use client';

import { useState, useRef, useEffect } from 'react';
import Image from "next/image";
import styles from "./page.module.css";
import axios from 'axios';
import BookContentDisplay from "../components/BookContentDisplay";

// Upload processing states
type UploadState = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

export default function Home() {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAreaRef = useRef<HTMLLabelElement>(null);

  // Track mouse position for upload area hover effect
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
    
    // Update mouse position for glow effect
    if (uploadAreaRef.current) {
      const rect = uploadAreaRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  // Handle file upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset states
    setUploadState('uploading');
    setUploadProgress(0);
    setError(null);
    setBookId(null);

    try {
      // Create form data for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Upload to our API endpoint with progress tracking
      const response = await axios.post('/api/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 300000, // 5 minutes (300,000ms)
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        },
      });

      // Once upload is complete, set state to processing
      setUploadState('processing');
      
      // Handle response
      if (response.data.isBook) {
        // Store the book ID for content analysis
        setBookId(response.data.bookId);
        setUploadState('success');
      } else {
        setError('The image does not appear to contain a clear book cover. Please retake the photo.');
        setUploadState('error');
      }
    } catch (err: any) {
      console.error('Error uploading image:', err);
      
      // Special handling for service unavailable (503) errors
      if (err.response?.status === 503) {
        // If we got a book ID but the service is unavailable, still show the book content
        // The BookContentDisplay component will handle the polling
        if (err.response?.data?.bookId) {
          setBookId(err.response.data.bookId);
          setUploadState('success');
        } else {
          setError('Our processing service is temporarily busy. Your request is in the queue and will be processed soon.');
          setUploadState('processing'); // Keep showing processing state
        }
      } else {
        // Handle other errors
        setError(err.response?.data?.error || 'An error occurred while processing your image.');
        setUploadState('error');
      }
    } finally {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      if (fileInputRef.current) {
        fileInputRef.current.files = files;
        handleUpload({ target: { files } } as any);
      }
    }
  };
  
  // Update mouse position for hover effect
  const handleMouseMove = (e: React.MouseEvent) => {
    if (uploadAreaRef.current) {
      const rect = uploadAreaRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  // Reset the upload form
  const handleReset = () => {
    setUploadState('idle');
    setUploadProgress(0);
    setError(null);
    setBookId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Determine if we should show the book display
  const showBookDisplay = bookId && (uploadState === 'success' || uploadState === 'processing');

  return (
    <div className={styles.page}>
      <div className={styles.backgroundGradient} />
      
      <main className={styles.main}>
        <div className={styles.splitLayout}>
          <div className={styles.leftSection}>
            <div className={styles.header}>
              <div className={styles.logo}>
                <Image
                  src="/book.svg"
                  alt=""
                  width={22}
                  height={22}
                  className="opacity-80"
                />
                <h1 className={styles.title}>Book Explorer AI</h1>
              </div>
              <p className={styles.subtitle}>
                Upload a book cover to extract and view its first pages.
              </p>
            </div>

            {uploadState === 'idle' ? (
              <label 
                className={`${styles.uploadSection} ${isDragging ? styles.uploadDragging : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onMouseMove={handleMouseMove}
                ref={uploadAreaRef}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                  ref={fileInputRef}
                />
                <div 
                  className={styles.uploadGlow} 
                  style={{ 
                    left: `${mousePosition.x}px`, 
                    top: `${mousePosition.y}px`,
                    transform: 'translate(-50%, -50%)',
                    opacity: isDragging ? 0.5 : undefined
                  }}
                />
                <div className={styles.uploadIcon}>
                  <Image
                    src="/upload.svg"
                    alt="Upload icon"
                    width={32}
                    height={32}
                    priority
                    className="opacity-80"
                  />
                </div>
                <p className={styles.uploadText}>
                  Drop your book cover here
                </p>
                <p className={styles.uploadSubtext}>
                  or click to browse files
                </p>
              </label>
            ) : (
              <div className={`${styles.uploadSection} ${styles.uploadProgress}`}>
                {/* Progress indicator */}
                {uploadState === 'uploading' && (
                  <>
                    <div className={styles.progressBarContainer}>
                      <div 
                        className={styles.progressBar} 
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className={styles.uploadIcon}>
                      <Image
                        src="/spinner.svg"
                        alt="Loading"
                        width={24}
                        height={24}
                        className="animate-spin"
                      />
                    </div>
                    <p className={styles.uploadText}>
                      Uploading book cover... {uploadProgress}%
                    </p>
                  </>
                )}
                
                {/* Processing state */}
                {uploadState === 'processing' && (
                  <>
                    <div className={styles.uploadIcon}>
                      <Image
                        src="/spinner.svg"
                        alt="Loading"
                        width={24}
                        height={24}
                        className="animate-spin"
                      />
                    </div>
                    <p className={styles.uploadText}>
                      Processing your book...
                    </p>
                    <p className={styles.uploadSubtext}>
                      This usually takes 1-2 minutes
                    </p>
                  </>
                )}
                
                {/* Success state */}
                {uploadState === 'success' && (
                  <>
                    <div className={styles.uploadIcon}>
                      <div className="relative">
                        {/* Animated spinner for "still processing" effect */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin"></div>
                        </div>
                        {/* Check icon shown on top */}
                        <Image
                          src="/check.svg"
                          alt="Success"
                          width={32}
                          height={32}
                          className="relative z-10 text-green-500"
                        />
                      </div>
                    </div>
                    <p className={styles.uploadText}>
                      Book cover uploaded!
                    </p>
                    <p className={styles.uploadSubtext}>
                      Analyzing content on the right
                    </p>
                    <button 
                      onClick={handleReset}
                      className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
                    >
                      Upload a different book
                    </button>
                  </>
                )}
                
                {/* Error state */}
                {uploadState === 'error' && (
                  <>
                    <div className={styles.uploadIcon}>
                      <Image
                        src="/error.svg"
                        alt="Error"
                        width={32}
                        height={32}
                        className="text-red-500"
                      />
                    </div>
                    <p className={styles.uploadText}>
                      Upload failed
                    </p>
                    <p className={styles.uploadSubtext}>
                      {error || 'An unknown error occurred'}
                    </p>
                    <button 
                      onClick={handleReset}
                      className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
                    >
                      Try again
                    </button>
                  </>
                )}
              </div>
            )}

            {error && uploadState !== 'error' && (
              <div className={styles.error}>
                <strong>Unable to process image • </strong>{error}
              </div>
            )}
          </div>

          <div className={styles.rightSection}>
            {showBookDisplay ? (
              <BookContentDisplay bookId={bookId} />
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <Image
                    src="/arrow-up.svg"
                    alt=""
                    width={24}
                    height={24}
                    className="opacity-60"
                  />
                </div>
                <p className={styles.emptyStateText}>
                  Upload a book cover to view its first pages
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
