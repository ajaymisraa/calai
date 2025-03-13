import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Book processing log utility
 * 
 * This utility handles collecting and storing logs in the book's folder
 * for tracking processing history and debugging.
 */

// Base cache directory for books
const CACHE_DIR = path.join(process.cwd(), 'cache', 'book-images');

// Singleton log collector for the current operation
class LogCollector {
  private static instance: LogCollector;
  private logs: string[] = [];
  private startTime: Date;
  private active: boolean = false;
  private bookId: string | null = null;

  private constructor() {
    this.startTime = new Date();
  }

  public static getInstance(): LogCollector {
    if (!LogCollector.instance) {
      LogCollector.instance = new LogCollector();
    }
    return LogCollector.instance;
  }

  /**
   * Start collecting logs for a specific book
   * @param bookId The ID of the book being processed
   */
  public startCollection(bookId: string): void {
    this.bookId = bookId;
    this.logs = [];
    this.startTime = new Date();
    this.active = true;
    
    // Add header information
    this.addLog(`=== Book Processing Log ===`);
    this.addLog(`Book ID: ${bookId}`);
    this.addLog(`Started: ${this.startTime.toISOString()}`);
    this.addLog(`System: ${os.platform()} ${os.release()}`);
    this.addLog(`Node: ${process.version}`);
    this.addLog(`===============================`);
    this.addLog(``);
  }

  /**
   * Add a log entry
   * @param message The log message
   */
  public addLog(message: string): void {
    if (!this.active) return;
    
    const timestamp = new Date().toISOString();
    this.logs.push(`[${timestamp}] ${message}`);
  }

  /**
   * Save the collected logs to the book's folder
   * @param additionalInfo Optional additional information to add to the log
   * @returns Path to the log file or null if saving failed
   */
  public saveLogs(additionalInfo?: Record<string, any>): string | null {
    if (!this.active || !this.bookId) return null;
    
    try {
      // Get the book directory
      const bookDir = path.join(CACHE_DIR, this.bookId);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(bookDir)) {
        fs.mkdirSync(bookDir, { recursive: true });
      }
      
      // Add completion timestamp
      const endTime = new Date();
      const duration = (endTime.getTime() - this.startTime.getTime()) / 1000;
      
      this.addLog(``);
      this.addLog(`=== Processing Complete ===`);
      this.addLog(`Finished: ${endTime.toISOString()}`);
      this.addLog(`Duration: ${duration.toFixed(2)} seconds`);
      
      // Add any additional info
      if (additionalInfo) {
        this.addLog(`=== Additional Information ===`);
        Object.entries(additionalInfo).forEach(([key, value]) => {
          this.addLog(`${key}: ${JSON.stringify(value)}`);
        });
      }
      
      // Generate a timestamp for the log filename
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const logFileName = `processing_log_${timestamp}.txt`;
      const logFilePath = path.join(bookDir, logFileName);
      
      // Write logs to file
      fs.writeFileSync(logFilePath, this.logs.join('\n'), 'utf8');
      
      // Also save the latest log with a standard name for easy access
      const latestLogPath = path.join(bookDir, 'latest_processing.log');
      fs.writeFileSync(latestLogPath, this.logs.join('\n'), 'utf8');
      
      // Reset for next collection
      this.active = false;
      
      return logFilePath;
    } catch (error) {
      console.error('Error saving logs:', error);
      return null;
    }
  }
}

/**
 * Intercept and redirect console output to both the console and the log collector
 * @param bookId The ID of the book being processed
 */
export function setupLogging(bookId: string): void {
  const logCollector = LogCollector.getInstance();
  logCollector.startCollection(bookId);
  
  // Store original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;
  
  // Override console methods to capture logs
  console.log = function(...args: any[]) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logCollector.addLog(`[LOG] ${message}`);
    originalConsoleLog.apply(console, args);
  };
  
  console.error = function(...args: any[]) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logCollector.addLog(`[ERROR] ${message}`);
    originalConsoleError.apply(console, args);
  };
  
  console.warn = function(...args: any[]) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logCollector.addLog(`[WARN] ${message}`);
    originalConsoleWarn.apply(console, args);
  };
  
  console.info = function(...args: any[]) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logCollector.addLog(`[INFO] ${message}`);
    originalConsoleInfo.apply(console, args);
  };
}

/**
 * Save the collected logs and restore original console methods
 * @param additionalInfo Optional additional information to add to the log
 * @returns Path to the log file or null if saving failed
 */
export function saveLogsAndRestore(additionalInfo?: Record<string, any>): string | null {
  const logCollector = LogCollector.getInstance();
  return logCollector.saveLogs(additionalInfo);
}

/**
 * Add a log entry without affecting the console output
 * Useful for logging things you don't want to show in the console
 * @param message The log message
 */
export function addSilentLog(message: string): void {
  const logCollector = LogCollector.getInstance();
  logCollector.addLog(message);
}

/**
 * Create a log entry specifically marking a key processing milestone
 * @param milestoneName The name of the milestone
 * @param details Additional details about the milestone
 */
export function logMilestone(milestoneName: string, details?: string): void {
  const logCollector = LogCollector.getInstance();
  logCollector.addLog(`===== MILESTONE: ${milestoneName} =====`);
  if (details) {
    logCollector.addLog(details);
  }
  console.log(`Milestone reached: ${milestoneName}`);
} 