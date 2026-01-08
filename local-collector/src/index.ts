#!/usr/bin/env node

import { Command } from 'commander';
import { Collector } from './collector';

const program = new Command();

program
  .name('local-collector')
  .description('Local browser automation for invoice collection with reCAPTCHA support')
  .version('1.0.0');

program
  .command('collect')
  .description('Collect invoices from a vendor')
  .requiredOption('--vendor <vendor>', 'Vendor key (e.g., ibj)')
  .option('--token <token>', 'One-time authentication token from Review Web App')
  .option('--target-month <month>', 'Target month in YYYY-MM format (default: previous month)')
  .option('--headless', 'Run in headless mode (not recommended for reCAPTCHA)')
  .option('--no-upload', 'Skip uploading to Google Drive')
  .action(async (options) => {
    const collector = new Collector({
      vendorKey: options.vendor,
      token: options.token,
      targetMonth: options.targetMonth,
      headless: options.headless || false,
      skipUpload: !options.upload,
    });

    try {
      await collector.run();
    } catch (error) {
      console.error('Collection failed:', error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check pending vendor tasks')
  .option('--token <token>', 'Authentication token')
  .action(async (options) => {
    console.log('Checking pending vendors...');
    // TODO: Implement status check via GAS API
    console.log('Status check not yet implemented');
  });

program.parse();
