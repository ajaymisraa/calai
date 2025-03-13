#!/usr/bin/env ts-node

/**
 * Script to test the API endpoints directly
 * 
 * Usage:
 * ts-node testAPI.ts
 */

import axios from 'axios';

// Test the content-analysis endpoint
async function testContentAnalysisAPI() {
  try {
    console.log('Testing content-analysis API endpoint...');
    
    // Make request to local API - note that routes are prefixed with /api
    const response = await axios.get('http://localhost:3002/api/content-analysis/yng_CwAAQBAJ');
    
    console.log('API Response Status:', response.status);
    console.log('API Response Data:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Check if response contains firstPageContent and secondPageContent
    if (!response.data.firstPageContent) {
      console.error('Error: API response does not contain firstPageContent');
    } else {
      console.log(`First page content length: ${response.data.firstPageContent.length} characters`);
      console.log(`First page content excerpt: ${response.data.firstPageContent.substring(0, 100)}...`);
    }
    
    if (!response.data.secondPageContent) {
      console.error('Error: API response does not contain secondPageContent');
    } else {
      console.log(`Second page content length: ${response.data.secondPageContent.length} characters`);
      console.log(`Second page content excerpt: ${response.data.secondPageContent.substring(0, 100)}...`);
    }
    
    // Check if response contains isNonFiction
    console.log(`Is Non-Fiction: ${response.data.isNonFiction !== undefined ? response.data.isNonFiction : 'Not specified'}`);
    
  } catch (error) {
    console.error('Error testing content-analysis API:', error);
    
    // If error is an axios error, print response details
    if (axios.isAxiosError(error) && error.response) {
      console.error('API Error Status:', error.response.status);
      console.error('API Error Data:', error.response.data);
    }
  }
}

// Main function to run all tests
async function main() {
  try {
    await testContentAnalysisAPI();
  } catch (error) {
    console.error('Unhandled error:', error);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
});