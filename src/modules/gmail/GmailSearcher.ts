/**
 * Gmail search and message retrieval
 */

import { AppLogger } from '../../utils/logger';

export class GmailSearcher {
  /**
   * Search Gmail for messages matching the query
   * @param query Gmail search query
   * @param excludeProcessed Exclude messages with 'processed' label
   */
  search(query: string, excludeProcessed: boolean = true): GoogleAppsScript.Gmail.GmailMessage[] {
    try {
      let searchQuery = query;

      if (excludeProcessed) {
        searchQuery += ' -label:processed';
      }

      AppLogger.info(`Searching Gmail with query: ${searchQuery}`);

      const threads = GmailApp.search(searchQuery);
      const messages: GoogleAppsScript.Gmail.GmailMessage[] = [];

      threads.forEach(thread => {
        messages.push(...thread.getMessages());
      });

      AppLogger.info(`Found ${messages.length} messages`);

      return messages;
    } catch (error) {
      AppLogger.error('Error searching Gmail', error as Error);
      throw error;
    }
  }

  /**
   * Mark message as processed by adding label
   */
  markAsProcessed(message: GoogleAppsScript.Gmail.GmailMessage): void {
    try {
      const label = this.getOrCreateLabel('processed');
      message.getThread().addLabel(label);
      AppLogger.debug(`Marked message ${message.getId()} as processed`);
    } catch (error) {
      AppLogger.error('Error marking message as processed', error as Error);
      throw error;
    }
  }

  /**
   * Get or create a label
   */
  private getOrCreateLabel(labelName: string): GoogleAppsScript.Gmail.GmailLabel {
    let label = GmailApp.getUserLabelByName(labelName);

    if (!label) {
      label = GmailApp.createLabel(labelName);
      AppLogger.info(`Created label: ${labelName}`);
    }

    return label;
  }
}
