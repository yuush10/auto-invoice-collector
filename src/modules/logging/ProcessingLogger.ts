/**
 * Processing log management with Google Sheets
 */

import { ProcessingLog } from '../../types';
import { AppLogger } from '../../utils/logger';

export class ProcessingLogger {
  private sheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(sheetId: string) {
    this.sheetId = sheetId;
    this.sheet = this.getOrCreateSheet();
  }

  /**
   * Get or create the processing log sheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    try {
      const spreadsheet = SpreadsheetApp.openById(this.sheetId);
      let sheet = spreadsheet.getSheetByName('ProcessingLog');

      if (!sheet) {
        sheet = spreadsheet.insertSheet('ProcessingLog');
        this.initializeHeaders(sheet);
        AppLogger.info('Created new ProcessingLog sheet');
      }

      return sheet;
    } catch (error) {
      AppLogger.error('Error getting/creating sheet', error as Error);
      throw error;
    }
  }

  /**
   * Initialize sheet headers
   */
  private initializeHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const headers = [
      'Timestamp',
      'Message ID',
      'Attachment Index',
      'SHA256',
      'Source Type',
      'Doc Type',
      'Service Name',
      'Event Month',
      'Drive File ID',
      'Status',
      'Error Message'
    ];

    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Log a processing record
   */
  log(record: ProcessingLog): void {
    try {
      const row = [
        record.timestamp,
        record.messageId,
        record.attachmentIndex ?? '',
        record.sha256,
        record.sourceType,
        record.docType,
        record.serviceName,
        record.eventMonth,
        record.driveFileId,
        record.status,
        record.errorMessage || ''
      ];

      this.sheet.appendRow(row);
      AppLogger.debug(`Logged processing record for message ${record.messageId}`);
    } catch (error) {
      AppLogger.error('Error logging processing record', error as Error);
      throw error;
    }
  }

  /**
   * Check if a message + attachment has already been processed
   */
  isProcessed(messageId: string, attachmentIndex?: number): boolean {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        const rowMessageId = data[i][1];
        const rowAttachmentIndex = data[i][2];

        if (rowMessageId === messageId) {
          if (attachmentIndex === undefined) {
            return true;
          }
          if (rowAttachmentIndex === attachmentIndex) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      AppLogger.error('Error checking if processed', error as Error);
      return false;
    }
  }

  /**
   * Check if a file hash already exists (duplicate detection)
   */
  hashExists(sha256: string): boolean {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][3] === sha256) {
          return true;
        }
      }

      return false;
    } catch (error) {
      AppLogger.error('Error checking hash', error as Error);
      return false;
    }
  }

  /**
   * Get processing statistics
   */
  getStats(startDate?: Date): { total: number; success: number; errors: number; needsReview: number } {
    try {
      const data = this.sheet.getDataRange().getValues();
      let total = 0;
      let success = 0;
      let errors = 0;
      let needsReview = 0;

      for (let i = 1; i < data.length; i++) {
        const timestamp = new Date(data[i][0]);

        if (startDate && timestamp < startDate) {
          continue;
        }

        total++;
        const status = data[i][9];

        if (status === 'success') {
          success++;
        } else if (status === 'error') {
          errors++;
        } else if (status === 'needs-review') {
          needsReview++;
        }
      }

      return { total, success, errors, needsReview };
    } catch (error) {
      AppLogger.error('Error getting stats', error as Error);
      return { total: 0, success: 0, errors: 0, needsReview: 0 };
    }
  }
}
