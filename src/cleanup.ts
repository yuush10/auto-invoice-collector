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

/**
 * Diagnostic function to check what Anthropic emails exist
 * Tests multiple search queries to find the correct one
 */
function diagnosticAnthropicEmails(): void {
  AppLogger.info('=== Diagnostic: Searching for Anthropic emails ===');

  const queries = [
    'from:mail.anthropic.com',
    'from:anthropic.com',
  ];

  for (const query of queries) {
    try {
      AppLogger.info(`\n--- Testing query: "${query}" ---`);
      const threads = GmailApp.search(query);
      AppLogger.info(`Found ${threads.length} threads (without filter)`);

      if (threads.length > 0) {
        const messages = threads[0].getMessages();
        const firstMessage = messages[0];

        AppLogger.info('First matching email:');
        AppLogger.info(`  Subject: ${firstMessage.getSubject()}`);
        AppLogger.info(`  From: ${firstMessage.getFrom()}`);
        AppLogger.info(`  To: ${firstMessage.getTo()}`);
        AppLogger.info(`  Date: ${firstMessage.getDate()}`);
        AppLogger.info(`  Attachments: ${firstMessage.getAttachments().length}`);

        // Check labels - THIS IS THE KEY PART
        const labels = threads[0].getLabels();
        const labelNames = labels.map(l => l.getName()).join(', ');
        AppLogger.info(`  Labels: ${labelNames || 'none'}`);

        const hasProcessedLabel = labels.some(l => l.getName() === 'processed');
        if (hasProcessedLabel) {
          AppLogger.info(`  ⚠️  HAS "processed" LABEL - This is why it's being filtered out!`);
        }

        if (firstMessage.getAttachments().length > 0) {
          AppLogger.info('  Attachment names:');
          firstMessage.getAttachments().forEach((att, i) => {
            AppLogger.info(`    ${i + 1}. ${att.getName()} (${att.getContentType()})`);
          });
        }
      }

      // Test with -label:processed filter (what the script actually uses)
      const queryWithFilter = `${query} -label:processed`;
      AppLogger.info(`\nTesting with filter: "${queryWithFilter}"`);
      const threadsFiltered = GmailApp.search(queryWithFilter);
      AppLogger.info(`Found ${threadsFiltered.length} threads (WITH -label:processed filter)`);

      if (threads.length > 0 && threadsFiltered.length === 0) {
        AppLogger.info(`✓ CONFIRMED: Emails exist but are filtered out by -label:processed`);
      }

    } catch (error) {
      AppLogger.error(`Error with query "${query}"`, error as Error);
    }
  }

  AppLogger.info('\n=== Diagnostic complete ===');
}

/**
 * Remove "processed" label from Anthropic emails to allow re-processing
 */
function cleanupAnthropicProcessedLabel(): void {
  AppLogger.info('Removing "processed" label from Anthropic emails');

  try {
    const label = GmailApp.getUserLabelByName('processed');
    if (!label) {
      AppLogger.info('No "processed" label found, nothing to clean up');
      return;
    }

    const threads = GmailApp.search('from:mail.anthropic.com');
    AppLogger.info(`Found ${threads.length} Anthropic email threads`);

    let removedCount = 0;
    threads.forEach(thread => {
      const hasLabel = thread.getLabels().some(l => l.getName() === 'processed');
      if (hasLabel) {
        thread.removeLabel(label);
        removedCount++;
        const messages = thread.getMessages();
        AppLogger.info(`Removed "processed" label from: ${messages[0].getSubject()}`);
      }
    });

    AppLogger.info(`Successfully removed "processed" label from ${removedCount} threads`);
    AppLogger.info('You can now run main() to process these Anthropic emails');

  } catch (error) {
    AppLogger.error('Error during cleanup', error as Error);
    throw error;
  }
}

// Export to global scope
(globalThis as any).cleanupFailedMessages = cleanupFailedMessages;
(globalThis as any).diagnosticAnthropicEmails = diagnosticAnthropicEmails;
(globalThis as any).cleanupAnthropicProcessedLabel = cleanupAnthropicProcessedLabel;
