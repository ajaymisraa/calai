#!/usr/bin/env ts-node

/**
 * Script to clean a specific book directory
 * Removes all files that don't start with 'preview'
 * 
 * Usage:
 *   ts-node cleanBookDirectory.ts [bookId]
 * 
 * If no bookId is provided, it will clean the specific directory
 * mentioned in the user query: yng_CwAAQBAJ
 */

import * as bookImageCache from '../services/bookImageCache';

const bookId = process.argv[2] || 'yng_CwAAQBAJ';

console.log(`Cleaning book directory for: ${bookId}`);
const removedCount = bookImageCache.cleanSpecificBookDirectory(bookId);

console.log(`Script completed. Removed ${removedCount} files.`); 