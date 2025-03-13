/**
 * Serverless Chrome setup for Vercel
 * This module provides an API endpoint to download and setup Chrome
 * on Vercel's serverless environment
 * 
 * Optimized for:
 * - Concurrent executions (uses lockfiles to prevent race conditions)
 * - Memory efficiency (streams data to avoid OOM errors)
 * - Atomic operations (won't leave partial installations)
 * - Error handling and cleanup
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import * as fs from 'fs-extra'; // Using fs-extra for atomic file operations
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// URL to a minimal compatible Chrome build
const CHROME_URL = 'https://github.com/Sparticuz/chromium/releases/download/v119.0.0/chromium-v119.0.0-pack.tar';
const TEMP_DIR = '/tmp/vercel-playwright';
const CHROME_PATH = process.env.CHROME_PATH || path.join(TEMP_DIR, 'chromium');
const CHROME_EXECUTABLE = path.join(CHROME_PATH, 'chrome');
const LOCK_FILE = path.join(TEMP_DIR, '.chrome-setup.lock');
const MARKER_FILE = path.join(TEMP_DIR, '.chrome-setup-complete');

/**
 * Check if Chrome is already set up correctly
 */
async function isSetupComplete(): Promise<boolean> {
  try {
    // Check if Chrome executable exists
    if (!await fs.pathExists(CHROME_EXECUTABLE)) {
      return false;
    }
    
    // Check the executable bit
    try {
      const stats = await fs.stat(CHROME_EXECUTABLE);
      const executable = !!(stats.mode & fs.constants.X_OK);
      if (!executable) {
        return false;
      }
    } catch (e) {
      return false;
    }
    
    // Check for marker file
    if (await fs.pathExists(MARKER_FILE)) {
      // Check how old the marker is (don't trust setups older than 24 hours)
      const stats = await fs.stat(MARKER_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      const ageHours = ageMs / (1000 * 60 * 60);
      
      return ageHours < 24; // Consider valid if less than 24 hours old
    }
    
    return false;
  } catch (e) {
    console.error('Error checking Chrome setup:', e);
    return false;
  }
}

/**
 * Acquires a lock for atomic Chrome setup
 * Returns true if lock was acquired, false otherwise
 */
async function acquireLock(): Promise<boolean> {
  try {
    // Ensure directory exists
    await fs.ensureDir(TEMP_DIR);
    
    // Try to create lock file
    await fs.writeFile(LOCK_FILE, Date.now().toString(), { flag: 'wx' });
    return true;
  } catch (e) {
    // Check if lock is stale (older than 2 minutes)
    try {
      const stats = await fs.stat(LOCK_FILE);
      const ageMs = Date.now() - stats.mtimeMs;
      const ageMinutes = ageMs / (1000 * 60);
      
      if (ageMinutes > 2) {
        // Lock is stale, remove and reacquire
        await fs.remove(LOCK_FILE);
        await fs.writeFile(LOCK_FILE, Date.now().toString(), { flag: 'wx' });
        return true;
      }
    } catch (statError) {
      // If we can't check the stats, something's wrong
      return false;
    }
    
    return false;
  }
}

/**
 * Releases the setup lock
 */
async function releaseLock(): Promise<void> {
  try {
    await fs.remove(LOCK_FILE);
  } catch (e) {
    console.warn('Failed to release lock:', e);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Create a unique ID for this request for tracking in logs
  const requestId = crypto.randomBytes(4).toString('hex');
  console.log(`[${requestId}] Chrome setup request received`);
  
  // Check if Chrome is already set up properly
  const alreadySetup = await isSetupComplete();
  if (alreadySetup) {
    console.log(`[${requestId}] Chrome is already set up at ${CHROME_PATH}`);
    return res.status(200).json({ 
      message: 'Chrome is already set up',
      path: CHROME_PATH
    });
  }
  
  // Try to acquire lock
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log(`[${requestId}] Could not acquire lock, another process is setting up Chrome`);
    return res.status(202).json({ 
      message: 'Chrome setup is already in progress by another process',
      status: 'in_progress'
    });
  }
  
  // Create a unique work directory for this request
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(os.tmpdir(), `chrome-setup-${uniqueId}`);
  const downloadPath = path.join(workDir, 'chrome.tar');
  const extractDir = path.join(workDir, 'extract');
  
  try {
    // Check again after acquiring lock
    const setupComplete = await isSetupComplete();
    if (setupComplete) {
      console.log(`[${requestId}] Chrome was set up by another process`);
      return res.status(200).json({ 
        message: 'Chrome was set up by another process',
        path: CHROME_PATH
      });
    }
    
    // Create work directories
    await fs.ensureDir(workDir);
    await fs.ensureDir(extractDir);
    
    // Download Chrome with timeouts and retries
    console.log(`[${requestId}] Downloading Chrome from ${CHROME_URL}...`);
    
    let downloadSuccess = false;
    let retries = 2;
    
    while (!downloadSuccess && retries > 0) {
      try {
        const response = await fetch(CHROME_URL, { timeout: 15000 });
        
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
        
        downloadSuccess = true;
        console.log(`[${requestId}] Chrome download complete`);
      } catch (downloadError) {
        retries--;
        if (retries === 0) throw downloadError;
        console.log(`[${requestId}] Download failed, retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Extract Chrome to temporary location
    console.log(`[${requestId}] Extracting Chrome...`);
    await execAsync(`tar -xf ${downloadPath} -C ${extractDir}`);
    console.log(`[${requestId}] Chrome extracted successfully`);

    // Make Chrome executable
    console.log(`[${requestId}] Setting permissions...`);
    await execAsync(`chmod -R 755 ${extractDir}`);

    // Move to final location atomically
    console.log(`[${requestId}] Moving Chrome to final location...`);
    
    // Clean up existing Chrome if present
    if (await fs.pathExists(CHROME_PATH)) {
      await fs.remove(CHROME_PATH);
    }
    
    // Create target directory
    await fs.ensureDir(path.dirname(CHROME_PATH));
    
    // Move files
    await fs.move(extractDir, CHROME_PATH, { overwrite: true });
    
    // Create marker file
    await fs.writeFile(MARKER_FILE, new Date().toISOString());
    
    console.log(`[${requestId}] Chrome setup complete`);

    return res.status(200).json({ 
      message: 'Chrome setup successful',
      path: CHROME_PATH
    });
  } catch (error) {
    console.error(`[${requestId}] Error setting up Chrome:`, error);
    return res.status(500).json({ 
      error: 'Failed to setup Chrome',
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    // Always release lock and clean up work directory
    await releaseLock();
    
    try {
      if (await fs.pathExists(workDir)) {
        await fs.remove(workDir);
      }
    } catch (cleanupError) {
      console.warn(`[${requestId}] Failed to clean up work directory:`, cleanupError);
    }
    
    console.log(`[${requestId}] Chrome setup request finished`);
  }
}