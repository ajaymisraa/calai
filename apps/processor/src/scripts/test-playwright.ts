/**
 * Test script to verify Playwright functionality in a serverless environment
 */
import { chromium } from 'playwright-core';
import { getChromiumOptions, cleanupChrome } from '../utils/vercelPlaywright';

async function testPlaywright() {
  console.log('Starting Playwright test...');
  
  // For test purposes, use a simpler configuration
  // This avoids the user-data-dir warning in local development
  const browser = await chromium.launch({ 
    headless: true 
  });
  console.log('Browser launched successfully');
  
  try {
    // Create a new page
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log('Page created successfully');
    
    // Navigate to a test URL
    await page.goto('https://www.google.com');
    console.log('Navigation successful');
    
    // Take a screenshot
    const screenshot = await page.screenshot();
    console.log(`Screenshot taken: ${screenshot.length} bytes`);
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
    await cleanupChrome(); // Cleanup temporary files
    console.log('Browser closed and resources cleaned up');
  }
}

// Run the test
testPlaywright().catch(console.error);