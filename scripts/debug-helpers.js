#!/usr/bin/env node

/**
 * Debug helper utilities for Windows compatibility
 */

export function enableDebug() {
  process.env.LOG_LEVEL = 'debug';
}

export function runWithDebug(scriptPath) {
  enableDebug();
  return import(scriptPath);
}

// Windows-compatible debug runners
export const debugRunners = {
  graph: () => runWithDebug('./test-graph-api.js'),
  cma: () => runWithDebug('./test-cma-api.js'),
  all: () => runWithDebug('./test-all.js'),
  quick: () => runWithDebug('./test-quick.js')
};

// If run directly, check command line args
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = process.argv[2];
  if (test && debugRunners[test]) {
    debugRunners[test]().catch(console.error);
  } else {
    console.log('Usage: node debug-helpers.js [graph|cma|all|quick]');
  }
}