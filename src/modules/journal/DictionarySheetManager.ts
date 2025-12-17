/**
 * Dictionary Sheet Manager for learned journal entry patterns
 * Manages the DictionarySheet in Google Sheets for storing vendor/service patterns
 * Includes version control for 電子帳簿保存法 compliance
 */

import {
  DictionaryEntry,
  DICTIONARY_SHEET_COLUMNS,
  PaymentMethod,
  ExpenseTiming
} from '../../types/journal';
import { DocumentType } from '../../types';
import { AppLogger } from '../../utils/logger';
import { DictionaryHistorySheetManager } from './DictionaryHistorySheetManager';

const SHEET_NAME = 'DictionarySheet';

export class DictionarySheetManager {
  private spreadsheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;
  private historyManager: DictionaryHistorySheetManager;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.sheet = this.getOrCreateSheet();
    this.historyManager = new DictionaryHistorySheetManager(spreadsheetId);
  }

  /**
   * Get or create the DictionarySheet
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
    const headers = DICTIONARY_SHEET_COLUMNS.map(col => col);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Generate a new UUID for dictionary entries
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
   * Create a new dictionary entry
   * Records creation in history for audit trail
   */
  create(
    entry: Omit<DictionaryEntry, 'dictId' | 'version' | 'useCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>,
    changedBy?: string
  ): DictionaryEntry {
    try {
      const now = new Date();
      const dictId = this.generateUuid();
      const user = changedBy || this.getCurrentUser();

      const fullEntry: DictionaryEntry = {
        ...entry,
        dictId,
        version: 1,
        useCount: 0,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now
      };

      const row = this.entryToRow(fullEntry);
      this.sheet.appendRow(row);

      // Record creation in history
      this.historyManager.recordCreation(fullEntry, user);

      AppLogger.info(`Created dictionary entry: ${dictId} (v1)`);
      return fullEntry;
    } catch (error) {
      AppLogger.error('Error creating dictionary entry', error as Error);
      throw error;
    }
  }

  /**
   * Get a dictionary entry by ID
   */
  getById(dictId: string): DictionaryEntry | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === dictId) {
          return this.rowToEntry(data[i]);
        }
      }

      return null;
    } catch (error) {
      AppLogger.error('Error getting dictionary entry by ID', error as Error);
      return null;
    }
  }

  /**
   * Get all dictionary entries
   */
  getAll(): DictionaryEntry[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const entries: DictionaryEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        entries.push(this.rowToEntry(data[i]));
      }

      return entries;
    } catch (error) {
      AppLogger.error('Error getting all dictionary entries', error as Error);
      return [];
    }
  }

  /**
   * Find dictionary entries by vendor name (exact or alias match)
   */
  findByVendor(vendorName: string): DictionaryEntry[] {
    try {
      const normalizedName = vendorName.toLowerCase().trim();
      const data = this.sheet.getDataRange().getValues();
      const matches: DictionaryEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        const entry = this.rowToEntry(data[i]);
        const entryVendor = entry.vendorName.toLowerCase().trim();

        if (entryVendor === normalizedName) {
          matches.push(entry);
          continue;
        }

        const aliasMatch = entry.vendorAliases.some(
          alias => alias.toLowerCase().trim() === normalizedName
        );

        if (aliasMatch) {
          matches.push(entry);
        }
      }

      return matches;
    } catch (error) {
      AppLogger.error('Error finding by vendor', error as Error);
      return [];
    }
  }

  /**
   * Find dictionary entries by service name (exact or alias match)
   */
  findByService(serviceName: string): DictionaryEntry[] {
    try {
      const normalizedName = serviceName.toLowerCase().trim();
      const data = this.sheet.getDataRange().getValues();
      const matches: DictionaryEntry[] = [];

      for (let i = 1; i < data.length; i++) {
        const entry = this.rowToEntry(data[i]);
        const entryService = entry.serviceName.toLowerCase().trim();

        if (entryService === normalizedName) {
          matches.push(entry);
          continue;
        }

        const aliasMatch = entry.serviceAliases.some(
          alias => alias.toLowerCase().trim() === normalizedName
        );

        if (aliasMatch) {
          matches.push(entry);
        }
      }

      return matches;
    } catch (error) {
      AppLogger.error('Error finding by service', error as Error);
      return [];
    }
  }

  /**
   * Find best match for vendor and service combination
   */
  findBestMatch(
    vendorName: string,
    serviceName: string
  ): DictionaryEntry | null {
    try {
      const vendorMatches = this.findByVendor(vendorName);

      if (vendorMatches.length === 0) {
        return null;
      }

      const normalizedService = serviceName.toLowerCase().trim();

      for (const entry of vendorMatches) {
        const entryService = entry.serviceName.toLowerCase().trim();

        if (entryService === normalizedService) {
          return entry;
        }

        const aliasMatch = entry.serviceAliases.some(
          alias => alias.toLowerCase().trim() === normalizedService
        );

        if (aliasMatch) {
          return entry;
        }
      }

      if (vendorMatches.length === 1) {
        return vendorMatches[0];
      }

      return null;
    } catch (error) {
      AppLogger.error('Error finding best match', error as Error);
      return null;
    }
  }

  /**
   * Update a dictionary entry
   * Increments version and records change in history
   */
  update(
    dictId: string,
    updates: Partial<DictionaryEntry>,
    reason?: string,
    changedBy?: string
  ): DictionaryEntry | null {
    try {
      const data = this.sheet.getDataRange().getValues();
      const user = changedBy || this.getCurrentUser();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === dictId) {
          const existingEntry = this.rowToEntry(data[i]);
          const newVersion = existingEntry.version + 1;

          const updatedEntry: DictionaryEntry = {
            ...existingEntry,
            ...updates,
            dictId: existingEntry.dictId,
            version: newVersion,
            createdAt: existingEntry.createdAt,
            updatedAt: new Date()
          };

          const row = this.entryToRow(updatedEntry);
          const range = this.sheet.getRange(i + 1, 1, 1, row.length);
          range.setValues([row]);

          // Record update in history
          this.historyManager.recordUpdate(existingEntry, updatedEntry, user, reason);

          AppLogger.info(`Updated dictionary entry: ${dictId} (v${newVersion})`);
          return updatedEntry;
        }
      }

      AppLogger.warn(`Dictionary entry not found for update: ${dictId}`);
      return null;
    } catch (error) {
      AppLogger.error('Error updating dictionary entry', error as Error);
      return null;
    }
  }

  /**
   * Increment use count and update last used timestamp
   * Note: This is considered a minor update and increments version
   */
  recordUsage(dictId: string, changedBy?: string): DictionaryEntry | null {
    const entry = this.getById(dictId);
    if (!entry) {
      return null;
    }

    return this.update(
      dictId,
      {
        useCount: entry.useCount + 1,
        lastUsedAt: new Date()
      },
      'Usage recorded',
      changedBy
    );
  }

  /**
   * Add vendor alias
   */
  addVendorAlias(dictId: string, alias: string, changedBy?: string): DictionaryEntry | null {
    const entry = this.getById(dictId);
    if (!entry) {
      return null;
    }

    if (!entry.vendorAliases.includes(alias)) {
      const aliases = [...entry.vendorAliases, alias];
      return this.update(dictId, { vendorAliases: aliases }, `Added vendor alias: ${alias}`, changedBy);
    }

    return entry;
  }

  /**
   * Add service alias
   */
  addServiceAlias(dictId: string, alias: string, changedBy?: string): DictionaryEntry | null {
    const entry = this.getById(dictId);
    if (!entry) {
      return null;
    }

    if (!entry.serviceAliases.includes(alias)) {
      const aliases = [...entry.serviceAliases, alias];
      return this.update(dictId, { serviceAliases: aliases }, `Added service alias: ${alias}`, changedBy);
    }

    return entry;
  }

  /**
   * Delete a dictionary entry (soft delete via history)
   * Records deletion in history before removing from sheet
   */
  delete(dictId: string, reason?: string, changedBy?: string): boolean {
    try {
      const data = this.sheet.getDataRange().getValues();
      const user = changedBy || this.getCurrentUser();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === dictId) {
          const entry = this.rowToEntry(data[i]);

          // Record deletion in history before removing
          this.historyManager.recordDeletion(entry, user, reason);

          this.sheet.deleteRow(i + 1);
          AppLogger.info(`Deleted dictionary entry: ${dictId}`);
          return true;
        }
      }

      AppLogger.warn(`Dictionary entry not found for deletion: ${dictId}`);
      return false;
    } catch (error) {
      AppLogger.error('Error deleting dictionary entry', error as Error);
      return false;
    }
  }

  /**
   * Get history for a dictionary entry
   */
  getHistory(dictId: string) {
    return this.historyManager.getHistoryByDictId(dictId);
  }

  /**
   * Get snapshot of a dictionary entry at a specific version
   */
  getSnapshotAtVersion(dictId: string, version: number) {
    return this.historyManager.getSnapshotAtVersion(dictId, version);
  }

  /**
   * Convert DictionaryEntry to row array
   */
  private entryToRow(entry: DictionaryEntry): (string | number | boolean | Date)[] {
    return [
      entry.dictId,
      entry.vendorName,
      entry.serviceName,
      JSON.stringify(entry.vendorAliases),
      JSON.stringify(entry.serviceAliases),
      entry.docType,
      entry.defaultAccount,
      entry.defaultSubAccount,
      entry.defaultTaxClass,
      entry.defaultDepartment,
      entry.paymentMethod,
      entry.paymentAccount,
      entry.paymentSubAccount,
      entry.isPrepaid,
      entry.prepaidAccount,
      entry.expenseTiming,
      JSON.stringify(entry.tags),
      entry.descriptionTemplate,
      entry.confidenceThreshold,
      entry.useCount,
      entry.lastUsedAt || '',
      entry.version,
      entry.createdAt,
      entry.updatedAt
    ];
  }

  /**
   * Convert row array to DictionaryEntry
   */
  private rowToEntry(row: unknown[]): DictionaryEntry {
    return {
      dictId: row[0] as string,
      vendorName: row[1] as string,
      serviceName: row[2] as string,
      vendorAliases: row[3] ? JSON.parse(row[3] as string) : [],
      serviceAliases: row[4] ? JSON.parse(row[4] as string) : [],
      docType: row[5] as DocumentType,
      defaultAccount: row[6] as string,
      defaultSubAccount: row[7] as string,
      defaultTaxClass: row[8] as string,
      defaultDepartment: row[9] as string,
      paymentMethod: row[10] as PaymentMethod,
      paymentAccount: row[11] as string,
      paymentSubAccount: row[12] as string,
      isPrepaid: Boolean(row[13]),
      prepaidAccount: row[14] as string,
      expenseTiming: row[15] as ExpenseTiming,
      tags: row[16] ? JSON.parse(row[16] as string) : [],
      descriptionTemplate: row[17] as string,
      confidenceThreshold: Number(row[18]),
      useCount: Number(row[19]),
      lastUsedAt: row[20] ? new Date(row[20] as string) : null,
      version: Number(row[21]) || 1,
      createdAt: new Date(row[22] as string),
      updatedAt: new Date(row[23] as string)
    };
  }
}
