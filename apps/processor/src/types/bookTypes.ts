/**
 * Book-related type definitions
 */

export interface BookMetadata {
  isBook: boolean;
  title?: string;
  author?: string;
  isNonFiction?: boolean;
  confidence?: number;
}

export interface OCRResult {
  pageNumber: number | string;
  text: string;
  confidence: number;
  imagePath: string;
}

export interface PageInsight {
  pageNumber: number;
  contentType: string;
  isFrontMatter: boolean;
  isMainContent: boolean;
  summary: string;
}

export interface ContentAnalysisResult {
  firstContentPage: number;
  isNonFiction: boolean;
  confidence: number;
  pageInsights: PageInsight[];
  recommendedStartPage?: number;
}

export interface PreviewOCRPage {
  pageNumber: number | string;
  leftText: string;
  rightText: string;
  leftConfidence: number;
  rightConfidence: number;
  leftImagePath: string;
  rightImagePath: string;
}

export interface PreviewOCRResult {
  fullText: string;
  pages: PreviewOCRPage[];
  averageConfidence: number;
}

export interface BookContent {
  metadata: BookMetadata;
  pages?: string[];
  previewImages?: string[];
  sequentialPages?: {
    imagePaths: string[];
    ocrResults: OCRResult[];
  };
  coverImage?: string;
  source?: string;
  contentAnalysis?: ContentAnalysisResult;
  previewOCRResults?: PreviewOCRResult;
  recommendedStartPage?: number;
} 