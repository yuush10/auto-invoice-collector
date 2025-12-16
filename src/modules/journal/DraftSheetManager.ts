/**
 * Draft Sheet Manager for journal entry drafts
 * Manages the DraftSheet in Google Sheets for storing journal entry drafts
 */

import {
  DraftEntry,
  DraftStatus,
  DRAFT_SHEET_COLUMNS,
  SuggestedEntries,
  JournalEntry
} from '../../types/journal';
import { AppLogger } from '../../utils/logger';

const SHEET_NAME = 'DraftSheet';

export class DraftSheetManager {
  private spreadsheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.sheet = this.getOrCreateSheet();
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
   * Create a new draft entry
   */
  create(draft: Omit<DraftEntry, 'draftId' | 'createdAt' | 'updatedAt'>): DraftEntry {
    try {
      const now = new Date();
      const draftId = this.generateUuid();

      const fullDraft: DraftEntry = {
        ...draft,
        draftId,
        createdAt: now,
        updatedAt: now
      };

      const row = this.draftToRow(fullDraft);
      this.sheet.appendRow(row);

      AppLogger.info(`Created draft entry: ${draftId}`);
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
        if (data[i][12] === eventMonth) {
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
   */
  update(draftId: string, updates: Partial<DraftEntry>): boolean {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === draftId) {
          const existingDraft = this.rowToDraft(data[i]);
          const updatedDraft: DraftEntry = {
            ...existingDraft,
            ...updates,
            draftId: existingDraft.draftId,
            createdAt: existingDraft.createdAt,
            updatedAt: new Date()
          };

          const row = this.draftToRow(updatedDraft);
          const range = this.sheet.getRange(i + 1, 1, 1, row.length);
          range.setValues([row]);

          AppLogger.info(`Updated draft entry: ${draftId}`);
          return true;
        }
      }

      AppLogger.warn(`Draft not found for update: ${draftId}`);
      return false;
    } catch (error) {
      AppLogger.error('Error updating draft', error as Error);
      return false;
    }
  }

  /**
   * Update draft status
   */
  updateStatus(
    draftId: string,
    status: DraftStatus,
    reviewedBy?: string
  ): boolean {
    const updates: Partial<DraftEntry> = { status };

    if (status === 'reviewed' || status === 'approved') {
      updates.reviewedBy = reviewedBy || '';
      updates.reviewedAt = new Date();
    }

    return this.update(draftId, updates);
  }

  /**
   * Set selected journal entry
   */
  setSelectedEntry(draftId: string, entries: JournalEntry[]): boolean {
    return this.update(draftId, { selectedEntry: entries });
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
      issueDate: row[10] as string,
      dueDate: row[11] as string,
      eventMonth: row[12] as string,
      paymentMonth: row[13] as string,
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
      createdAt: new Date(row[21] as string),
      updatedAt: new Date(row[22] as string)
    };
  }
}
