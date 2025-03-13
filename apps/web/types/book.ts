export interface BookPage {
  pageNumber: number;
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

export interface ContentAnalysis {
  firstContentPage: number;
  isNonFiction: boolean;
  confidence: number;
  pageInsights: PageInsight[];
  recommendedStartPage: number;
}

export interface BookMetadata {
  isBook: boolean;
  title?: string;
  author?: string;
  description?: string;
  confidence?: number;
  coverImageUrl?: string;
  isNonFiction?: boolean;
}

export interface ImageUrls {
  cover: string | null;
  previews: string[];
}

// Google Books API types
export interface GoogleBooksVolume {
  id: string;
  selfLink: string;
  volumeInfo: {
    title: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    averageRating?: number;
    ratingsCount?: number;
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
    language?: string;
    previewLink?: string;
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
  accessInfo: {
    country: string;
    viewability: 'NO_PAGES' | 'PARTIAL' | 'ALL_PAGES' | 'TEXTUAL';
    embeddable: boolean;
    publicDomain: boolean;
    textToSpeechPermission: string;
    epub: {
      isAvailable: boolean;
      acsTokenLink?: string;
      downloadLink?: string;
    };
    pdf: {
      isAvailable: boolean;
      acsTokenLink?: string;
      downloadLink?: string;
    };
    webReaderLink?: string;
    accessViewStatus: string;
    quoteSharingAllowed?: boolean;
  };
  saleInfo?: {
    country: string;
    saleability: string;
    isEbook: boolean;
    listPrice?: {
      amount: number;
      currencyCode: string;
    };
    retailPrice?: {
      amount: number;
      currencyCode: string;
    };
    buyLink?: string;
  };
  searchInfo?: {
    textSnippet?: string;
  };
}

export interface GoogleBooksResponse {
  kind: string;
  totalItems: number;
  items: GoogleBooksVolume[];
}

export interface ContentAnalysisResult {
  frontMatterPages: number;
  firstContentPage: number;
  isNonFiction: boolean;
  contentInsights: string;
}

export interface OCRResult {
  text: string;
  imagePath: string;
  confidence: number;
}

export interface SequentialPages {
  imagePaths: string[];
  ocrResults: OCRResult[];
}

export interface GoogleBooksData {
  id: string;
  previewLink?: string;
  webReaderLink?: string;
  embedLink?: string;
  viewability: 'NO_PAGES' | 'PARTIAL' | 'ALL_PAGES';
  embeddable: boolean;
  extractedPageText?: string;
  previewPages?: string[]; // Array of image URLs for downloaded preview pages
}

export interface BookData {
  metadata: BookMetadata;
  text?: string[];
  imageUrls?: string[];
  source?: string;
  previewImages?: string[];
  coverImage?: string;
  sequentialPages?: SequentialPages;
  contentAnalysis?: ContentAnalysisResult;
  recommendedStartPage?: number;
  googleBooksData?: GoogleBooksData;
} 