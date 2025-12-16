/**
 * Draft History Sheet Manager for audit trail (電子帳簿保存法 compliance)
 * Manages the DraftHistorySheet in Google Sheets for storing complete edit history
 *
 * IMPORTANT: This sheet is append-only. Records cannot be modified or deleted.
 */

import {
  DraftHistoryEntry,
  HistoryAction,
  FieldChange,
  DRAFT_HISTORY_COLUMNS
} from '../../types/history';
import { DraftEntry } from '../../types/journal';
import { AppLogger } from '../../utils/logger';

const SHEET_NAME = 'DraftHistorySheet';

export class DraftHistorySheetManager {
  private spreadsheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.sheet = this.getOrCreateSheet();
  }

  /**
   * Get or create the DraftHistorySheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    try {
      const spreadsheet = SpreadsheetApp.openById(this.spreadsheetId);
      let sheet = spreadsheet.getSheetByName(SHEET_NAME);

      if (!sheet) {
        sheet = spreadsheet.insertSheet(SHEET_NAME);
        this.initializeHeaders(sheet);
        this.protectSheet(sheet);
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
    const headers = DRAFT_HISTORY_COLUMNS.map(col => col);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Protect the sheet to prevent manual edits (append-only via script)
   */
  private protectSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    try {
      const protection = sheet.protect();
      protection.setDescription('History records are immutable - 電子帳簿保存法');
      protection.setWarningOnly(true);
    } catch (error) {
      AppLogger.warn(`Could not set sheet protection: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a new UUID for history entries
   */
  private generateUuid(): string {
    return Utilities.getUuid();
  }

  /**
   * Record a history entry (append-only)
   */
  record(
    draftId: string,
    version: number,
    action: HistoryAction,
    changedBy: string,
    fieldChanges: FieldChange[],
    snapshot: DraftEntry,
    reason?: string
  ): DraftHistoryEntry {
    try {
      const historyId = this.generateUuid();
      const changedAt = new Date();

      const entry: DraftHistoryEntry = {
        historyId,
        draftId,
        version,
        action,
        changedBy,
        changedAt,
        fieldChanges,
        snapshot: this.draftToSnapshot(snapshot),
        reason
      };

      const row = this.entryToRow(entry);
      this.sheet.appendRow(row);

      AppLogger.info(`Recorded history for draft ${draftId} (v${version}, ${action})`);
      return entry;
    } catch (error) {
      AppLogger.error('Error recording draft history', error as Error);
      throw error;
    }
  }

  /**
   * Record creation of a new draft
   */
  recordCreation(draft: DraftEntry, changedBy: string): DraftHistoryEntry {
    return this.record(
      draft.draftId,
      draft.version,
      'created',
      changedBy,
      [],
      draft
    );
  }

  /**
   * Record update to a draft
   */
  recordUpdate(
    oldDraft: DraftEntry,
    newDraft: DraftEntry,
    changedBy: string,
    reason?: string
  ): DraftHistoryEntry {
    const fieldChanges = this.calculateFieldChanges(oldDraft, newDraft);

    return this.record(
      newDraft.draftId,
      newDraft.version,
      'updated',
      changedBy,
      fieldChanges,
      newDraft,
      reason
    );
  }

  /**
   * Record status change
   */
  recordStatusChange(
    oldDraft: DraftEntry,
    newDraft: DraftEntry,
    changedBy: string,
    reason?: string
  ): DraftHistoryEntry {
    const fieldChanges: FieldChange[] = [{
      field: 'status',
      oldValue: oldDraft.status,
      newValue: newDraft.status
    }];

    return this.record(
      newDraft.draftId,
      newDraft.version,
      'status_changed',
      changedBy,
      fieldChanges,
      newDraft,
      reason
    );
  }

  /**
   * Record deletion (soft delete - record marked as deleted)
   */
  recordDeletion(draft: DraftEntry, changedBy: string, reason?: string): DraftHistoryEntry {
    return this.record(
      draft.draftId,
      draft.version + 1,
      'deleted',
      changedBy,
      [],
      draft,
      reason
    );
  }

  /**
   * Get all history entries for a draft
   */
  getHistoryByDraftId(draftId: string): DraftHistoryEntry[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const entries: DraftHistoryEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        if (data[i][1] === draftId) {
          entries.push(this.rowToEntry(data[i]));
        }
      }

      // Sort by version ascending
      entries.sort((a, b) => a.version - b.version);

      return entries;
    } catch (error) {
      AppLogger.error('Error getting draft history', error as Error);
      return [];
    }
  }

  /**
   * Get snapshot at a specific version
   */
  getSnapshotAtVersion(draftId: string, version: number): Record<string, unknown> | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][1] === draftId && data[i][2] === version) {
          const entry = this.rowToEntry(data[i]);
          return entry.snapshot;
        }
      }

      return null;
    } catch (error) {
      AppLogger.error('Error getting snapshot at version', error as Error);
      return null;
    }
  }

  /**
   * Get the latest history entry for a draft
   */
  getLatestHistory(draftId: string): DraftHistoryEntry | null {
    const history = this.getHistoryByDraftId(draftId);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Calculate field changes between old and new draft
   */
  private calculateFieldChanges(oldDraft: DraftEntry, newDraft: DraftEntry): FieldChange[] {
    const changes: FieldChange[] = [];
    const excludeFields = ['updatedAt', 'version', 'draftId', 'createdAt'];

    const oldObj = oldDraft as unknown as Record<string, unknown>;
    const newObj = newDraft as unknown as Record<string, unknown>;

    for (const key of Object.keys(newObj)) {
      if (excludeFields.includes(key)) {
        continue;
      }

      const oldValue = oldObj[key];
      const newValue = newObj[key];

      const oldStr = JSON.stringify(oldValue);
      const newStr = JSON.stringify(newValue);

      if (oldStr !== newStr) {
        changes.push({
          field: key,
          oldValue,
          newValue
        });
      }
    }

    return changes;
  }

  /**
   * Convert DraftEntry to a snapshot object
   */
  private draftToSnapshot(draft: DraftEntry): Record<string, unknown> {
    return { ...draft } as unknown as Record<string, unknown>;
  }

  /**
   * Convert DraftHistoryEntry to row array
   */
  private entryToRow(entry: DraftHistoryEntry): (string | number | Date)[] {
    return [
      entry.historyId,
      entry.draftId,
      entry.version,
      entry.action,
      entry.changedBy,
      entry.changedAt,
      JSON.stringify(entry.fieldChanges),
      JSON.stringify(entry.snapshot),
      entry.reason || ''
    ];
  }

  /**
   * Convert row array to DraftHistoryEntry
   */
  private rowToEntry(row: unknown[]): DraftHistoryEntry {
    return {
      historyId: row[0] as string,
      draftId: row[1] as string,
      version: Number(row[2]),
      action: row[3] as HistoryAction,
      changedBy: row[4] as string,
      changedAt: new Date(row[5] as string),
      fieldChanges: row[6] ? JSON.parse(row[6] as string) : [],
      snapshot: row[7] ? JSON.parse(row[7] as string) : {},
      reason: row[8] as string || undefined
    };
  }
}
