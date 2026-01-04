/**
 * Pending Vendor Queue Manager
 * Manages the queue of vendors waiting for manual processing (e.g., CAPTCHA solving)
 * Uses Google Sheets for persistence
 */

import { Config, VENDOR_CONFIGS } from '../../config';
import { AppLogger } from '../../utils/logger';

const PENDING_QUEUE_SHEET_NAME = 'PendingVendorQueue';

/**
 * Status of a pending vendor task
 */
export type PendingVendorStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Pending vendor record
 */
export interface PendingVendorRecord {
  /** Unique ID for this record */
  id: string;
  /** Vendor key (e.g., 'ibj') */
  vendorKey: string;
  /** Vendor display name */
  vendorName: string;
  /** Date when the vendor was scheduled to run */
  scheduledDate: Date;
  /** Current status of the task */
  status: PendingVendorStatus;
  /** When the record was created */
  createdAt: Date;
  /** When processing started (optional) */
  startedAt?: Date;
  /** When processing completed (optional) */
  completedAt?: Date;
  /** Error message if failed (optional) */
  errorMessage?: string;
  /** Interactive session URL (for VNC access) */
  sessionUrl?: string;
}

/**
 * Column indices for pending vendor queue sheet (0-indexed)
 */
enum PendingQueueColumn {
  Id = 0,
  VendorKey = 1,
  VendorName = 2,
  ScheduledDate = 3,
  Status = 4,
  CreatedAt = 5,
  StartedAt = 6,
  CompletedAt = 7,
  ErrorMessage = 8,
  SessionUrl = 9,
}

/**
 * Pending Vendor Queue Manager
 * Uses Google Sheets to persist pending vendor tasks
 */
export class PendingVendorQueueManager {
  private spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor() {
    const sheetId = Config.getLogSheetId();
    this.spreadsheet = SpreadsheetApp.openById(sheetId);
    this.sheet = this.getOrCreateSheet();
  }

  /**
   * Get or create the pending queue sheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    let sheet = this.spreadsheet.getSheetByName(PENDING_QUEUE_SHEET_NAME);
    if (!sheet) {
      sheet = this.spreadsheet.insertSheet(PENDING_QUEUE_SHEET_NAME);
      // Add headers
      sheet.appendRow([
        'ID',
        'VendorKey',
        'VendorName',
        'ScheduledDate',
        'Status',
        'CreatedAt',
        'StartedAt',
        'CompletedAt',
        'ErrorMessage',
        'SessionUrl',
      ]);
      sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
      AppLogger.info('[PendingQueue] Created PendingVendorQueue sheet');
    }
    return sheet;
  }

  /**
   * Generate a unique ID for a pending record
   */
  private generateId(): string {
    return `PV-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Add a vendor to the pending queue
   */
  addPendingVendor(vendorKey: string, scheduledDate: Date): PendingVendorRecord {
    const vendorConfig = VENDOR_CONFIGS.find(v => v.vendorKey === vendorKey);
    const vendorName = vendorConfig?.vendorName || vendorKey;
    const now = new Date();
    const id = this.generateId();

    const record: PendingVendorRecord = {
      id,
      vendorKey,
      vendorName,
      scheduledDate,
      status: 'pending',
      createdAt: now,
    };

    const rowData = [
      record.id,
      record.vendorKey,
      record.vendorName,
      record.scheduledDate,
      record.status,
      record.createdAt,
      '', // startedAt
      '', // completedAt
      '', // errorMessage
      '', // sessionUrl
    ];

    this.sheet.appendRow(rowData);
    AppLogger.info(`[PendingQueue] Added pending vendor: ${vendorKey} (ID: ${id})`);

    return record;
  }

  /**
   * Get all pending vendor records
   */
  getAllRecords(): PendingVendorRecord[] {
    const data = this.sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return [];
    }

    return data.slice(1).map(row => this.rowToRecord(row));
  }

  /**
   * Get pending vendors (status = 'pending')
   */
  getPendingVendors(): PendingVendorRecord[] {
    return this.getAllRecords().filter(r => r.status === 'pending');
  }

  /**
   * Get a specific record by ID
   */
  getRecordById(id: string): PendingVendorRecord | null {
    const all = this.getAllRecords();
    return all.find(r => r.id === id) || null;
  }

  /**
   * Get pending record for a vendor (most recent pending)
   */
  getPendingForVendor(vendorKey: string): PendingVendorRecord | null {
    const pending = this.getPendingVendors()
      .filter(r => r.vendorKey === vendorKey)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return pending[0] || null;
  }

  /**
   * Update record status to 'processing' and set session URL
   */
  startProcessing(id: string, sessionUrl?: string): void {
    const rowNum = this.findRowById(id);
    if (rowNum === 0) {
      throw new Error(`Pending record not found: ${id}`);
    }

    const now = new Date();
    this.sheet.getRange(rowNum, PendingQueueColumn.Status + 1).setValue('processing');
    this.sheet.getRange(rowNum, PendingQueueColumn.StartedAt + 1).setValue(now);
    if (sessionUrl) {
      this.sheet.getRange(rowNum, PendingQueueColumn.SessionUrl + 1).setValue(sessionUrl);
    }

    AppLogger.info(`[PendingQueue] Started processing: ${id}`);
  }

  /**
   * Mark record as completed
   */
  markCompleted(id: string): void {
    const rowNum = this.findRowById(id);
    if (rowNum === 0) {
      throw new Error(`Pending record not found: ${id}`);
    }

    const now = new Date();
    this.sheet.getRange(rowNum, PendingQueueColumn.Status + 1).setValue('completed');
    this.sheet.getRange(rowNum, PendingQueueColumn.CompletedAt + 1).setValue(now);

    AppLogger.info(`[PendingQueue] Completed: ${id}`);
  }

  /**
   * Mark record as failed
   */
  markFailed(id: string, errorMessage: string): void {
    const rowNum = this.findRowById(id);
    if (rowNum === 0) {
      throw new Error(`Pending record not found: ${id}`);
    }

    const now = new Date();
    this.sheet.getRange(rowNum, PendingQueueColumn.Status + 1).setValue('failed');
    this.sheet.getRange(rowNum, PendingQueueColumn.CompletedAt + 1).setValue(now);
    this.sheet.getRange(rowNum, PendingQueueColumn.ErrorMessage + 1).setValue(errorMessage);

    AppLogger.info(`[PendingQueue] Failed: ${id} - ${errorMessage}`);
  }

  /**
   * Delete old completed/failed records (older than specified days)
   */
  cleanupOldRecords(olderThanDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const data = this.sheet.getDataRange().getValues();
    const rowsToDelete: number[] = [];

    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      const status = row[PendingQueueColumn.Status];
      const createdAt = new Date(row[PendingQueueColumn.CreatedAt]);

      if ((status === 'completed' || status === 'failed') && createdAt < cutoffDate) {
        rowsToDelete.push(i + 1); // 1-indexed
      }
    }

    // Delete rows from bottom to top to maintain indices
    for (const rowNum of rowsToDelete) {
      this.sheet.deleteRow(rowNum);
    }

    if (rowsToDelete.length > 0) {
      AppLogger.info(`[PendingQueue] Cleaned up ${rowsToDelete.length} old records`);
    }

    return rowsToDelete.length;
  }

  /**
   * Convert a sheet row to PendingVendorRecord
   */
  private rowToRecord(row: any[]): PendingVendorRecord {
    return {
      id: row[PendingQueueColumn.Id] as string,
      vendorKey: row[PendingQueueColumn.VendorKey] as string,
      vendorName: row[PendingQueueColumn.VendorName] as string,
      scheduledDate: new Date(row[PendingQueueColumn.ScheduledDate]),
      status: row[PendingQueueColumn.Status] as PendingVendorStatus,
      createdAt: new Date(row[PendingQueueColumn.CreatedAt]),
      startedAt: row[PendingQueueColumn.StartedAt]
        ? new Date(row[PendingQueueColumn.StartedAt])
        : undefined,
      completedAt: row[PendingQueueColumn.CompletedAt]
        ? new Date(row[PendingQueueColumn.CompletedAt])
        : undefined,
      errorMessage: row[PendingQueueColumn.ErrorMessage] as string || undefined,
      sessionUrl: row[PendingQueueColumn.SessionUrl] as string || undefined,
    };
  }

  /**
   * Find the row number for a record by ID (1-indexed, 0 if not found)
   */
  private findRowById(id: string): number {
    const data = this.sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][PendingQueueColumn.Id] === id) {
        return i + 1; // Convert to 1-indexed
      }
    }
    return 0;
  }
}

// Export singleton instance
let queueInstance: PendingVendorQueueManager | null = null;

export function getPendingVendorQueueManager(): PendingVendorQueueManager {
  if (!queueInstance) {
    queueInstance = new PendingVendorQueueManager();
  }
  return queueInstance;
}
