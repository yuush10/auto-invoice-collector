/**
 * Cleanup utility to retry failed messages
 * Run this once after fixing blocking issues
 */

import { Config } from './config';
import { AppLogger } from './utils/logger';

/**
 * Remove the "processed" label from messages that had errors
 * This allows them to be retried on the next run
 */
function cleanupFailedMessages(): void {
  AppLogger.info('Starting cleanup of failed messages');

  try {
    const spreadsheet = SpreadsheetApp.openById(Config.getLogSheetId());
    const sheet = spreadsheet.getSheetByName('ProcessingLog');

    if (!sheet) {
      AppLogger.error('ProcessingLog sheet not found', new Error('Sheet not found'));
      return;
    }

    const data = sheet.getDataRange().getValues();
    const messageIdsToRetry = new Set<string>();

    // Find all message IDs with error status
    for (let i = 1; i < data.length; i++) {
      const status = data[i][9]; // Status column
      const messageId = data[i][1]; // Message ID column

      if (status === 'error' && messageId) {
        messageIdsToRetry.add(messageId as string);
      }
    }

    AppLogger.info(`Found ${messageIdsToRetry.size} messages with errors to retry`);

    // Remove "processed" label from those messages
    const label = GmailApp.getUserLabelByName('processed');
    if (!label) {
      AppLogger.info('No "processed" label found, nothing to clean up');
      return;
    }

    let removedCount = 0;
    for (const messageId of messageIdsToRetry) {
      try {
        const message = GmailApp.getMessageById(messageId);
        if (message) {
          message.getThread().removeLabel(label);
          removedCount++;
          AppLogger.debug(`Removed "processed" label from message ${messageId}`);
        }
      } catch (error) {
        AppLogger.error(`Error removing label from message ${messageId}`, error as Error);
      }
    }

    AppLogger.info(`Successfully removed "processed" label from ${removedCount} messages`);
    AppLogger.info('You can now run main() again to retry processing these messages');

  } catch (error) {
    AppLogger.error('Error during cleanup', error as Error);
    throw error;
  }
}

// Export to global scope
(globalThis as any).cleanupFailedMessages = cleanupFailedMessages;
