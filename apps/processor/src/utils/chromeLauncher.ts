/**
 * Chrome setup for serverless environment
 * This utility sets up Chrome in Vercel serverless functions during startup
 * 
 * It provides a streamlined, atomic approach to downloading and installing
 * a small Chrome binary suitable for serverless environments.
 */

import fetch from 'node-fetch';
import * as fs from 'fs-extra'; // Using fs-extra for atomic operations
import * as path from 'path';
import * as os from 'os';
import * as util from 'util';
import * as childProcess from 'child_process';
import * as crypto from 'crypto';

const exec = util.promisify(childProcess.exec);

// Keep track of setup status with a lightweight cache mechanism
// This prevents redundant setup attempts across function invocations
let chromeSetupComplete = false;

interface ChromeSetupOptions {
  chromePath?: string;
  chromeUrl?: string;
  verbose?: boolean;
}

/**
 * Generates a lock file path for atomic Chrome installation
 */
function getLockFilePath(chromePath: string): string {
  const chromeDir = path.dirname(chromePath);
  return path.join(chromeDir, '.chrome-setup.lock');
}

/**
 * Checks whether Chrome is already set up with optional freshness check
 */
async function isChromeSetup(chromePath: string, maxAgeMinutes: number = 60): Promise<boolean> {
  try {
    // Check if Chrome executable exists
    if (!await fs.pathExists(chromePath)) {
      return false;
    }
    
    // Check the Chrome binary's executable bit
    try {
      const stats = await fs.stat(chromePath);
      const executable = !!(stats.mode & fs.constants.X_OK);
      if (!executable) {
        return false;
      }
    } catch (e) {
      return false;
    }
    
    // Check if there's a success marker file and it's recent enough
    const markerFile = path.join(path.dirname(chromePath), '.chrome-setup-complete');
    if (await fs.pathExists(markerFile)) {
      const stats = await fs.stat(markerFile);
      const ageMs = Date.now() - stats.mtimeMs;
      const ageMinutes = ageMs / (1000 * 60);
      
      // If marker is fresh enough, consider Chrome set up
      return ageMinutes < maxAgeMinutes;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Sets up Chrome in the serverless environment if needed
 * Uses a robust approach with locking, atomic operations, and status markers
 */
export async function setupChrome(options: ChromeSetupOptions = {}): Promise<string> {
  // If we've already set up Chrome in this function instance, skip
  if (chromeSetupComplete) {
    return options.chromePath || process.env.CHROME_PATH || '/tmp/vercel-playwright/chromium';
  }
  
  const chromePath = options.chromePath || process.env.CHROME_PATH || '/tmp/vercel-playwright/chromium';
  const executablePath = path.join(chromePath, 'chrome'); // Actual binary path
  const chromeUrl = options.chromeUrl || 'https://github.com/Sparticuz/chromium/releases/download/v119.0.0/chromium-v119.0.0-pack.tar';
  const verbose = options.verbose || false;
  
  // Only run in serverless environment
  if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    if (verbose) console.log('Not in serverless environment, skipping Chrome setup');
    return '';
  }
  
  try {
    // Check if Chrome is already installed and recent
    if (await isChromeSetup(executablePath)) {
      if (verbose) console.log(`Chrome already exists at ${chromePath}`);
      chromeSetupComplete = true;
      return executablePath;
    }
    
    // Create temp directory structure
    const chromeDir = path.dirname(chromePath);
    await fs.ensureDir(chromeDir);
    
    // Create a unique download directory to avoid conflicts
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const downloadDir = path.join(os.tmpdir(), `chrome-download-${uniqueId}`);
    await fs.ensureDir(downloadDir);
    const downloadPath = path.join(downloadDir, 'chrome.tar');
    const extractDir = path.join(downloadDir, 'extract');
    await fs.ensureDir(extractDir);
    
    // Create a lock file to ensure only one setup runs at a time
    const lockFile = getLockFilePath(chromePath);
    let lockAcquired = false;
    
    try {
      // Try to create the lock file (will throw if it exists)
      await fs.writeFile(lockFile, Date.now().toString(), { flag: 'wx' });
      lockAcquired = true;
      
      // Check again after acquiring the lock (another process might have completed setup)
      if (await isChromeSetup(executablePath)) {
        if (verbose) console.log(`Chrome was set up by another process at ${chromePath}`);
        chromeSetupComplete = true;
        return executablePath;
      }
      
      // For Vercel, try using the API endpoint first
      if (process.env.VERCEL) {
        try {
          const apiUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL;
          if (apiUrl) {
            const apiEndpoint = `https://${apiUrl.replace(/^https?:\/\//, '')}/api/chrome`;
            if (verbose) console.log(`Trying to use API endpoint: ${apiEndpoint}`);
            
            const response = await fetch(apiEndpoint, { 
              method: 'POST',
              timeout: 25000 // 25 second timeout
            });
            
            if (response.ok) {
              if (verbose) console.log('Chrome setup via API endpoint');
              
              // Create a marker file to indicate setup is complete
              const markerFile = path.join(path.dirname(chromePath), '.chrome-setup-complete');
              await fs.writeFile(markerFile, new Date().toISOString());
              
              chromeSetupComplete = true;
              return executablePath;
            } else {
              if (verbose) console.log(`API setup failed with status ${response.status}, falling back to direct download`);
            }
          }
        } catch (apiError) {
          if (verbose) console.log('API setup failed, falling back to direct download:', apiError);
        }
      }
      
      // Download Chrome directly
      if (verbose) console.log(`Downloading Chrome from ${chromeUrl}`);
      
      // Download with timeout and retry
      let downloaded = false;
      let retries = 2;
      
      while (!downloaded && retries > 0) {
        try {
          const response = await fetch(chromeUrl, { timeout: 15000 });
          
          if (!response.ok) {
            throw new Error(`Failed to download Chrome: ${response.statusText}`);
          }
          
          // Stream to file to avoid memory issues
          const fileStream = fs.createWriteStream(downloadPath);
          await new Promise<void>((resolve, reject) => {
            response.body.pipe(fileStream);
            response.body.on('error', reject);
            fileStream.on('finish', () => resolve());
          });
          
          downloaded = true;
          if (verbose) console.log('Chrome downloaded successfully');
        } catch (downloadError) {
          retries--;
          if (retries === 0) throw downloadError;
          if (verbose) console.log(`Download failed, retrying... (${retries} left)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Extract Chrome to temporary location first
      if (verbose) console.log(`Extracting Chrome to ${extractDir}`);
      await exec(`tar -xf ${downloadPath} -C ${extractDir}`);
      
      // Make Chrome executable
      await exec(`chmod -R 755 ${extractDir}`);
      
      // Move to final location atomically (to prevent partial installations)
      if (verbose) console.log(`Moving Chrome to final location: ${chromePath}`);
      
      // Remove existing Chrome if present
      if (await fs.pathExists(chromePath)) {
        await fs.remove(chromePath);
      }
      
      // Create the target directory
      await fs.ensureDir(path.dirname(chromePath));
      
      // Move extracted files to final location
      await fs.move(extractDir, chromePath, { overwrite: true });
      
      // Create a marker file to indicate setup is complete
      const markerFile = path.join(path.dirname(chromePath), '.chrome-setup-complete');
      await fs.writeFile(markerFile, new Date().toISOString());
      
      if (verbose) console.log('Chrome setup successful');
      chromeSetupComplete = true;
      return executablePath;
    } finally {
      // Clean up regardless of success or failure
      try {
        // Remove the download directory
        if (await fs.pathExists(downloadDir)) {
          await fs.remove(downloadDir);
        }
        
        // Remove the lock file if we created it
        if (lockAcquired && await fs.pathExists(lockFile)) {
          await fs.remove(lockFile);
        }
      } catch (cleanupError) {
        console.warn('Error during cleanup:', cleanupError);
      }
    }
  } catch (error) {
    console.error('Chrome setup failed:', error);
    // Return path anyway in case Chrome exists but setup failed for other reasons
    return executablePath;
  }
}

/**
 * For manual testing outside of a serverless environment
 */
if (require.main === module) {
  setupChrome({ verbose: true })
    .then((path) => console.log(`Chrome setup complete at: ${path}`))
    .catch((error) => console.error('Setup failed:', error));
}