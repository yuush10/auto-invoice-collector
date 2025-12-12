/**
 * Auto Invoice Collector - Main Entry Point
 *
 * This is the main entry point for the Google Apps Script application.
 * It contains the trigger functions that are called by GAS.
 */

/**
 * Main function that processes new invoices from Gmail
 * This function is called by the time-based trigger
 */
function main(): void {
  Logger.log('Auto Invoice Collector - Starting');

  try {
    // TODO: Implement main processing logic
    Logger.log('Processing complete');
  } catch (error) {
    Logger.log(`Error: ${error}`);
    throw error;
  }
}

/**
 * Manual trigger for testing
 */
function runManually(): void {
  main();
}

/**
 * Setup function to create the daily trigger
 * Run this once to set up automatic execution
 */
function setupTrigger(): void {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Create new daily trigger at 6 AM
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log('Daily trigger created successfully');
}

// Export for GAS
declare const global: {
  main: typeof main;
  runManually: typeof runManually;
  setupTrigger: typeof setupTrigger;
};

global.main = main;
global.runManually = runManually;
global.setupTrigger = setupTrigger;
