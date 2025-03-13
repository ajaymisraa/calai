/**
 * Utilities for using Playwright in Vercel serverless functions
 */
import { LaunchOptions } from 'playwright-core';
import * as os from 'os';
import * as fs from 'fs-extra'; // Using fs-extra for more robust file operations
import * as path from 'path';
import { setupChrome } from './chromeLauncher';

// Use a specific subdirectory in /tmp to avoid conflicts with other operations
// This helps organize our Chrome files separate from other temporary files
const TEMP_DIR = '/tmp/vercel-playwright';
const CHROME_PATH = process.env.CHROME_PATH || path.join(TEMP_DIR, 'chromium');
const BROWSER_DATA_DIR = path.join(TEMP_DIR, 'browser-data');
const DOWNLOAD_DIR = path.join(TEMP_DIR, 'downloads');

/**
 * Get the executable path for Chrome in a serverless environment
 * This handles both local development and Vercel deployment
 */
/**
 * Initialize temporary directories needed for Playwright
 * This ensures all required directories exist before we start
 */
export async function initTempDirectories(): Promise<void> {
  // Create temporary directories if they don't exist
  await fs.ensureDir(TEMP_DIR);
  await fs.ensureDir(BROWSER_DATA_DIR);
  await fs.ensureDir(DOWNLOAD_DIR);
  
  // Ensure proper permissions
  try {
    await fs.chmod(TEMP_DIR, 0o755);
    await fs.chmod(BROWSER_DATA_DIR, 0o755);
    await fs.chmod(DOWNLOAD_DIR, 0o755);
  } catch (e) {
    // Permission changes might fail in some environments, but we can continue
    console.warn('Failed to set directory permissions:', e);
  }
  
  // Clean up old downloads to avoid filling up /tmp
  try {
    const files = await fs.readdir(DOWNLOAD_DIR);
    // Only keep recent files (created within the last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const file of files) {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < oneHourAgo) {
        await fs.unlink(filePath);
      }
    }
  } catch (e) {
    // Clean up errors shouldn't stop the process
    console.warn('Failed to clean up old downloads:', e);
  }
}

export async function getChromePath(): Promise<string | undefined> {
  // If we're in a Vercel serverless environment, we need to use a custom Chrome path
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    // Initialize temp directories first
    await initTempDirectories();
    
    // Setup Chrome if needed
    await setupChrome({ 
      chromePath: CHROME_PATH,
      verbose: process.env.DEBUG === 'true' 
    });
    
    return CHROME_PATH;
  }
  
  // In local development, let Playwright use its own browser
  return undefined;
}

/**
 * Get optimized launch options for Chromium in a serverless environment
 */
export async function getChromiumOptions(): Promise<LaunchOptions> {
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION;
  
  // Base launch options with performance optimizations
  const options: LaunchOptions = {
    headless: true,
    args: [
      '--disable-dev-shm-usage',      // Use /tmp instead of /dev/shm (crucial for Vercel)
      '--disable-gpu',                // Reduces resource usage
      '--disable-setuid-sandbox',     // Required for Docker/container environments
      '--no-sandbox',                 // Required for serverless environments
      '--disable-web-security',       // Helps with CORS issues when navigating
      '--disable-features=IsolateOrigins',
      '--disable-site-isolation-trials',
      '--autoplay-policy=user-gesture-required',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-extensions',         // No need for extensions in serverless
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-popup-blocking',
      '--disable-print-preview',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-speech-api',
      '--disable-sync',
      '--hide-scrollbars',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-experiments',
      '--no-pings',
      '--password-store=basic',
      '--use-gl=swiftshader',
      '--use-mock-keychain',
      '--single-process',             // Use single process to reduce memory
      // userDataDir will be specified in the context, not here
      `--download-path=${DOWNLOAD_DIR}`,     // Set download path
      '--font-render-hinting=none',   // Reduce font rendering overhead
      '--force-color-profile=srgb',   // Consistent color profile
    ],
    // Set memory limits to avoid OOM issues
    executablePath: undefined, // Will be set below if needed
    // In Vercel, use lower timeout values for better error handling
    timeout: isServerless ? 30000 : 60000,
  };
  
  if (isServerless) {
    // Serverless environment - get path from setup
    const executablePath = await getChromePath();
    if (executablePath) {
      options.executablePath = executablePath;
    }
    
    // User data dir should be set in browser context
    
    // Add specific serverless memory settings
    options.args?.push('--js-flags=--max-old-space-size=460'); // Limit heap size (below Vercel's 512MB limit)
  }
  
  return options;
}

/**
 * Determine if we're running in a Vercel serverless environment
 */
export function isVercelServerless(): boolean {
  return !!process.env.VERCEL;
}

/**
 * Create a browser context with proper settings for Vercel serverless
 * This ensures we use the correct user data directory
 */
export async function createBrowserContext(browser: any, options: any = {}) {
  // Create a context with our specified data directory
  const contextOptions = {
    viewport: { width: 1280, height: 1024 },
    ...options
  };
  
  // Use persistent context in serverless for better efficiency
  if (isVercelServerless() || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    await initTempDirectories();
    return browser.newContext({
      ...contextOptions,
      userDataDir: BROWSER_DATA_DIR
    });
  }
  
  // For local development, use regular context
  return browser.newContext(contextOptions);
}

/**
 * Helper function to clean up the browser in a Vercel environment
 * This should be called after the browser is closed to free up resources
 */
export async function cleanupChrome(): Promise<void> {
  // Skip cleanup if not in a serverless environment
  if (!isVercelServerless() && !process.env.AWS_LAMBDA_FUNCTION_VERSION) return;
  
  try {
    // Use a mutex-like approach to avoid race conditions
    const lockFile = path.join(TEMP_DIR, '.cleanup-lock');
    
    // Create a lock file to indicate we're performing cleanup
    try {
      await fs.writeFile(lockFile, Date.now().toString(), { flag: 'wx' });
    } catch (e) {
      // If lock file already exists, another instance is cleaning up, so skip
      return;
    }
    
    try {
      // Clean up browser data directory (but not Chrome binary)
      // This saves space while keeping the Chrome installation
      if (await fs.pathExists(BROWSER_DATA_DIR)) {
        // Only delete the contents, not the directory itself
        const files = await fs.readdir(BROWSER_DATA_DIR);
        for (const file of files) {
          // Skip lock files and essential config
          if (file === '.config' || file.startsWith('.')) continue;
          
          const filePath = path.join(BROWSER_DATA_DIR, file);
          if ((await fs.stat(filePath)).isDirectory()) {
            await fs.emptyDir(filePath); // Safely empty directories
          } else {
            await fs.unlink(filePath);   // Remove files
          }
        }
        console.log('Browser data directory cleaned');
      }
      
      // Clean up the downloads directory
      if (await fs.pathExists(DOWNLOAD_DIR)) {
        await fs.emptyDir(DOWNLOAD_DIR);
        console.log('Downloads directory cleaned');
      }
      
      // Clean up old temp files in Chrome directory
      if (await fs.pathExists(CHROME_PATH)) {
        // For Chrome, we just delete temp files, not the binary
        const files = await fs.readdir(CHROME_PATH);
        for (const file of files) {
          if (file.includes('tmp') || file.includes('temp') || file.includes('cache')) {
            await fs.remove(path.join(CHROME_PATH, file));
          }
        }
      }
      
      // Clean up old Playwright-specific temp files
      const playwrightTmpDir = path.join(os.tmpdir(), '.playwright');
      if (await fs.pathExists(playwrightTmpDir)) {
        await fs.remove(playwrightTmpDir);
      }
      
      console.log('Chrome temporary directories cleaned up');
    } finally {
      // Always remove the lock file when done
      await fs.remove(lockFile);
    }
  } catch (error) {
    console.error('Failed to clean up Chrome temp directories:', error);
  }
}