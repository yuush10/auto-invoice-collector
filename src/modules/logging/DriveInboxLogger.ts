/**
 * Drive inbox processing log management
 * Tracks processed files in Google Sheets for audit and deduplication
 */

import { AppLogger } from '../../utils/logger';

export type InboxProcessingStatus =
  | 'success'
  | 'error'
  | 'skipped-non-pdf'
  | 'unknown-kept-in-inbox'
  | 'low-confidence';

export interface DriveInboxLogRecord {
  timestamp: Date;
  driveFileId: string;
  originalFileName: string;
  newFileName?: string;
  eventMonth?: string;
  serviceName?: string;
  docType?: string;
  confidence?: number;
  status: InboxProcessingStatus;
  targetFolderId?: string;
  errorMessage?: string;
}

export interface InboxProcessingSummary {
  processed: number;
  errors: number;
  skipped: number;
  unknownKept: number;
  errorRecords: DriveInboxLogRecord[];
  unknownRecords: DriveInboxLogRecord[];
}

export class DriveInboxLogger {
  private sheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet | null = null;

  constructor(sheetId: string) {
    this.sheetId = sheetId;
  }

  /**
   * Get or create the DriveInboxLog sheet
   */
  private getSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    if (this.sheet) {
      return this.sheet;
    }

    const spreadsheet = SpreadsheetApp.openById(this.sheetId);
    let sheet = spreadsheet.getSheetByName('DriveInboxLog');

    if (!sheet) {
      sheet = spreadsheet.insertSheet('DriveInboxLog');
      this.initializeHeaders(sheet);
      AppLogger.info('Created new DriveInboxLog sheet');
    }

    this.sheet = sheet;
    return sheet;
  }

  /**
   * Initialize sheet headers
   */
  private initializeHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const headers = [
      'Timestamp',
      'Drive File ID',
      'Original File Name',
      'New File Name',
      'Event Month',
      'Service Name',
      'Doc Type',
      'Confidence',
      'Status',
      'Target Folder ID',
      'Error Message',
    ];

    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Log a processing record
   */
  log(record: DriveInboxLogRecord): void {
    const sheet = this.getSheet();
    const row = [
      record.timestamp,
      record.driveFileId,
      record.originalFileName,
      record.newFileName || '',
      record.eventMonth || '',
      record.serviceName || '',
      record.docType || '',
      record.confidence ?? '',
      record.status,
      record.targetFolderId || '',
      record.errorMessage || '',
    ];

    sheet.appendRow(row);
    AppLogger.debug(`Logged inbox processing: ${record.driveFileId} - ${record.status}`);
  }

  /**
   * Check if a file has already been processed (by Drive File ID)
   * Skips entries with 'error' status to allow retry
   */
  isProcessed(driveFileId: string): boolean {
    const sheet = this.getSheet();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const rowFileId = data[i][1]; // Drive File ID column
      const rowStatus = data[i][8]; // Status column

      // Skip error entries to allow retry
      if (rowStatus === 'error') {
        continue;
      }

      if (rowFileId === driveFileId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get file IDs that failed and should be retried
   */
  getFailedFileIds(): string[] {
    const sheet = this.getSheet();
    const data = sheet.getDataRange().getValues();
    const failed: string[] = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][8] === 'error') {
        failed.push(data[i][1] as string);
      }
    }

    return failed;
  }

  /**
   * Get all log records since a given timestamp
   */
  getRecordsSince(since: Date): DriveInboxLogRecord[] {
    const sheet = this.getSheet();
    const data = sheet.getDataRange().getValues();
    const records: DriveInboxLogRecord[] = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const timestamp = row[0] as Date;

      // Skip rows before the given timestamp
      if (timestamp < since) {
        continue;
      }

      records.push({
        timestamp,
        driveFileId: row[1] as string,
        originalFileName: row[2] as string,
        newFileName: row[3] as string || undefined,
        eventMonth: row[4] as string || undefined,
        serviceName: row[5] as string || undefined,
        docType: row[6] as string || undefined,
        confidence: row[7] !== '' ? (row[7] as number) : undefined,
        status: row[8] as InboxProcessingStatus,
        targetFolderId: row[9] as string || undefined,
        errorMessage: row[10] as string || undefined,
      });
    }

    return records;
  }

  /**
   * Get aggregated stats since a given timestamp
   */
  getStatsSince(since: Date): InboxProcessingSummary {
    const records = this.getRecordsSince(since);

    const summary: InboxProcessingSummary = {
      processed: 0,
      errors: 0,
      skipped: 0,
      unknownKept: 0,
      errorRecords: [],
      unknownRecords: [],
    };

    for (const record of records) {
      switch (record.status) {
        case 'success':
          summary.processed++;
          break;
        case 'error':
          summary.errors++;
          summary.errorRecords.push(record);
          break;
        case 'skipped-non-pdf':
          summary.skipped++;
          break;
        case 'unknown-kept-in-inbox':
        case 'low-confidence':
          summary.unknownKept++;
          summary.unknownRecords.push(record);
          break;
      }
    }

    return summary;
  }
}
