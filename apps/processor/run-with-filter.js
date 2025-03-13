#!/usr/bin/env node

/**
 * This is a wrapper script that runs a command while filtering out specific warnings
 * Usage: node run-with-filter.js <command>
 * Example: node run-with-filter.js ts-node-dev --respawn src/index.ts
 */

const { spawn } = require('child_process');
const process = require('process');

// Get the command to run from the arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node run-with-filter.js <command>');
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

// Create a child process
const child = spawn(command, commandArgs, {
  stdio: ['inherit', 'pipe', 'pipe']
});

// Intercept stdout and stderr to filter out specific warnings
child.stdout.on('data', (data) => {
  process.stdout.write(data);
});

child.stderr.on('data', (data) => {
  const str = data.toString();
  // Only pass through messages that don't contain the ObjC warning
  if (!str.includes('Class GNotificationCenterDelegate is implemented in both') &&
      !(str.includes('libgio-2.0.0.dylib') && str.includes('libvips-cpp'))) {
    process.stderr.write(data);
  }
});

// Handle errors and exit
child.on('error', (error) => {
  console.error(`Error starting process: ${error}`);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code);
});