/**
 * Draft Sheet Manager for journal entry drafts
 * Manages the DraftSheet in Google Sheets for storing journal entry drafts
 * Includes version control for 電子帳簿保存法 compliance
 */

import {
  DraftEntry,
  DraftStatus,
  DRAFT_SHEET_COLUMNS,
  SuggestedEntries,
  JournalEntry
} from '../../types/journal';
import { AppLogger } from '../../utils/logger';
import { DraftHistorySheetManager } from './DraftHistorySheetManager';

const SHEET_NAME = 'DraftSheet';

export class DraftSheetManager {
  private spreadsheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;
  private historyManager: DraftHistorySheetManager;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.sheet = this.getOrCreateSheet();
    this.historyManager = new DraftHistorySheetManager(spreadsheetId);
  }

  /**
   * Get or create the DraftSheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    try {
      const spreadsheet = SpreadsheetApp.openById(this.spreadsheetId);
      let sheet = spreadsheet.getSheetByName(SHEET_NAME);

      if (!sheet) {
        sheet = spreadsheet.insertSheet(SHEET_NAME);
        this.initializeHeaders(sheet);
        AppLogger.info(`Created new ${SHEET_NAME} sheet`);
      }

      return sheet;
    } catch (error) {
      AppLogger.error(`Error getting/creating ${SHEET_NAME}`, error as Error);
      throw error;
    }
  }

  /**
   * Initialize sheet headers
   */
  private initializeHeaders(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const headers = DRAFT_SHEET_COLUMNS.map(col => col);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Generate a new UUID for draft entries
   */
  private generateUuid(): string {
    return Utilities.getUuid();
  }

  /**
   * Get current user email for audit trail
   */
  private getCurrentUser(): string {
    try {
      return Session.getActiveUser().getEmail() || 'system';
    } catch {
      return 'system';
    }
  }

  /**
   * Create a new draft entry
   * Records creation in history for audit trail
   */
  create(
    draft: Omit<DraftEntry, 'draftId' | 'version' | 'createdAt' | 'updatedAt'>,
    changedBy?: string
  ): DraftEntry {
    try {
      const now = new Date();
      const draftId = this.generateUuid();
      const user = changedBy || this.getCurrentUser();

      const fullDraft: DraftEntry = {
        ...draft,
        draftId,
        version: 1,
        createdAt: now,
        updatedAt: now
      };

      const row = this.draftToRow(fullDraft);
      this.sheet.appendRow(row);

      // Record creation in history
      this.historyManager.recordCreation(fullDraft, user);

      AppLogger.info(`Created draft entry: ${draftId} (v1)`);
      return fullDraft;
    } catch (error) {
      AppLogger.error('Error creating draft entry', error as Error);
      throw error;
    }
  }

  /**
   * Get a draft entry by ID
   */
  getById(draftId: string): DraftEntry | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === draftId) {
          return this.rowToDraft(data[i]);
        }
      }

      return null;
    } catch (error) {
      AppLogger.error('Error getting draft by ID', error as Error);
      return null;
    }
  }

  /**
   * Get all draft entries with optional status filter
   */
  getAll(status?: DraftStatus): DraftEntry[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const drafts: DraftEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        const draft = this.rowToDraft(data[i]);
        if (!status || draft.status === status) {
          drafts.push(draft);
        }
      }

      return drafts;
    } catch (error) {
      AppLogger.error('Error getting all drafts', error as Error);
      return [];
    }
  }

  /**
   * Get drafts by event month
   */
  getByEventMonth(eventMonth: string): DraftEntry[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const drafts: DraftEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        // Convert the cell value to YYYY-MM format before comparison
        const cellEventMonth = this.toYearMonth(data[i][12]);
        if (cellEventMonth === eventMonth) {
          drafts.push(this.rowToDraft(data[i]));
        }
      }

      return drafts;
    } catch (error) {
      AppLogger.error('Error getting drafts by event month', error as Error);
      return [];
    }
  }

  /**
   * Update a draft entry
   * Increments version and records change in history
   */
  update(
    draftId: string,
    updates: Partial<DraftEntry>,
    reason?: string,
    changedBy?: string
  ): DraftEntry | null {
    try {
      const data = this.sheet.getDataRange().getValues();
      const user = changedBy || this.getCurrentUser();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === draftId) {
          const existingDraft = this.rowToDraft(data[i]);
          const newVersion = existingDraft.version + 1;

          const updatedDraft: DraftEntry = {
            ...existingDraft,
            ...updates,
            draftId: existingDraft.draftId,
            version: newVersion,
            createdAt: existingDraft.createdAt,
            updatedAt: new Date()
          };

          const row = this.draftToRow(updatedDraft);
          const range = this.sheet.getRange(i + 1, 1, 1, row.length);
          range.setValues([row]);

          // Record update in history
          this.historyManager.recordUpdate(existingDraft, updatedDraft, user, reason);

          AppLogger.info(`Updated draft entry: ${draftId} (v${newVersion})`);
          return updatedDraft;
        }
      }

      AppLogger.warn(`Draft not found for update: ${draftId}`);
      return null;
    } catch (error) {
      AppLogger.error('Error updating draft', error as Error);
      return null;
    }
  }

  /**
   * Update draft status
   * Records status change in history
   */
  updateStatus(
    draftId: string,
    status: DraftStatus,
    reviewedBy?: string,
    reason?: string
  ): DraftEntry | null {
    try {
      const data = this.sheet.getDataRange().getValues();
      const user = reviewedBy || this.getCurrentUser();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === draftId) {
          const existingDraft = this.rowToDraft(data[i]);
          const newVersion = existingDraft.version + 1;

          const updatedDraft: DraftEntry = {
            ...existingDraft,
            status,
            version: newVersion,
            updatedAt: new Date()
          };

          if (status === 'reviewed' || status === 'approved') {
            updatedDraft.reviewedBy = user;
            updatedDraft.reviewedAt = new Date();
          }

          const row = this.draftToRow(updatedDraft);
          const range = this.sheet.getRange(i + 1, 1, 1, row.length);
          range.setValues([row]);

          // Record status change in history
          this.historyManager.recordStatusChange(existingDraft, updatedDraft, user, reason);

          AppLogger.info(`Updated draft status: ${draftId} to ${status} (v${newVersion})`);
          return updatedDraft;
        }
      }

      AppLogger.warn(`Draft not found for status update: ${draftId}`);
      return null;
    } catch (error) {
      AppLogger.error('Error updating draft status', error as Error);
      return null;
    }
  }

  /**
   * Set selected journal entry
   */
  setSelectedEntry(
    draftId: string,
    entries: JournalEntry[],
    reason?: string,
    changedBy?: string
  ): DraftEntry | null {
    return this.update(draftId, { selectedEntry: entries }, reason, changedBy);
  }

  /**
   * Check if a file has already been processed
   */
  fileExists(fileId: string): boolean {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][1] === fileId) {
          return true;
        }
      }

      return false;
    } catch (error) {
      AppLogger.error('Error checking file existence', error as Error);
      return false;
    }
  }

  /**
   * Get statistics for drafts
   */
  getStats(): {
    total: number;
    pending: number;
    reviewed: number;
    approved: number;
    exported: number;
  } {
    try {
      const data = this.sheet.getDataRange().getValues();
      const stats = {
        total: 0,
        pending: 0,
        reviewed: 0,
        approved: 0,
        exported: 0
      };

      // Status is at column index 17
      for (let i = 1; i < data.length; i++) {
        stats.total++;
        const status = data[i][17] as DraftStatus;

        switch (status) {
          case 'pending':
            stats.pending++;
            break;
          case 'reviewed':
            stats.reviewed++;
            break;
          case 'approved':
            stats.approved++;
            break;
          case 'exported':
            stats.exported++;
            break;
        }
      }

      return stats;
    } catch (error) {
      AppLogger.error('Error getting draft stats', error as Error);
      return { total: 0, pending: 0, reviewed: 0, approved: 0, exported: 0 };
    }
  }

  /**
   * Get history for a draft
   */
  getHistory(draftId: string) {
    return this.historyManager.getHistoryByDraftId(draftId);
  }

  /**
   * Get snapshot of a draft at a specific version
   */
  getSnapshotAtVersion(draftId: string, version: number) {
    return this.historyManager.getSnapshotAtVersion(draftId, version);
  }

  /**
   * Convert DraftEntry to row array
   */
  private draftToRow(draft: DraftEntry): (string | number | boolean | Date)[] {
    return [
      draft.draftId,
      draft.fileId,
      draft.fileName,
      draft.filePath,
      draft.docType,
      draft.storageType,
      draft.vendorName,
      draft.serviceName,
      draft.amount,
      draft.taxAmount,
      draft.issueDate,
      draft.dueDate,
      draft.eventMonth,
      draft.paymentMonth,
      draft.suggestedEntries ? JSON.stringify(draft.suggestedEntries) : '',
      draft.selectedEntry ? JSON.stringify(draft.selectedEntry) : '',
      draft.dictionaryMatchId,
      draft.status,
      draft.reviewedBy,
      draft.reviewedAt || '',
      draft.notes,
      draft.version,
      draft.createdAt,
      draft.updatedAt
    ];
  }

  /**
   * Convert row array to DraftEntry
   */
  private rowToDraft(row: unknown[]): DraftEntry {
    return {
      draftId: row[0] as string,
      fileId: row[1] as string,
      fileName: row[2] as string,
      filePath: row[3] as string,
      docType: row[4] as DraftEntry['docType'],
      storageType: row[5] as DraftEntry['storageType'],
      vendorName: row[6] as string,
      serviceName: row[7] as string,
      amount: Number(row[8]),
      taxAmount: Number(row[9]),
      issueDate: this.toDateString(row[10]),
      dueDate: this.toDateString(row[11]),
      eventMonth: this.toYearMonth(row[12]),
      paymentMonth: this.toYearMonth(row[13]),
      suggestedEntries: row[14]
        ? (JSON.parse(row[14] as string) as SuggestedEntries)
        : null,
      selectedEntry: row[15]
        ? (JSON.parse(row[15] as string) as JournalEntry[])
        : null,
      dictionaryMatchId: row[16] as string,
      status: row[17] as DraftStatus,
      reviewedBy: row[18] as string,
      reviewedAt: row[19] ? new Date(row[19] as string) : null,
      notes: row[20] as string,
      version: Number(row[21]) || 1,
      createdAt: new Date(row[22] as string),
      updatedAt: new Date(row[23] as string)
    };
  }

  /**
   * Convert value to YYYY-MM format string
   * Handles both Date objects and strings
   */
  private toYearMonth(value: unknown): string {
    if (!value) return '';

    // If it's already a string in YYYY-MM format
    if (typeof value === 'string') {
      if (value.match(/^\d{4}-\d{2}$/)) {
        return value;
      }
      // Try to parse as date string
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
      }
      return value;
    }

    // If it's a Date object
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    }

    return String(value);
  }

  /**
   * Convert value to YYYY-MM-DD format string
   * Handles both Date objects and strings
   */
  private toDateString(value: unknown): string {
    if (!value) return '';

    // If it's already a string in YYYY-MM-DD format
    if (typeof value === 'string') {
      if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return value;
      }
      // Try to parse as date string
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return value;
    }

    // If it's a Date object
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return String(value);
  }
}
