/**
 * WebAppApi - Server-side API for Review Web UI
 * Provides all API endpoints for the Vue.js frontend
 */

import { DraftSheetManager } from '../modules/journal/DraftSheetManager';
import { DictionarySheetManager } from '../modules/journal/DictionarySheetManager';
import { DraftHistorySheetManager } from '../modules/journal/DraftHistorySheetManager';
import { DictionaryHistorySheetManager } from '../modules/journal/DictionaryHistorySheetManager';
import { PromptService } from '../modules/journal/PromptService';
import { JournalGenerator } from '../modules/journal/JournalGenerator';
import {
  DraftEntry,
  DraftStatus,
  JournalEntry,
  DictionaryEntry
} from '../types/journal';
import { DraftHistoryEntry, DictionaryHistoryEntry } from '../types/history';
import { PromptConfig, PromptType } from '../types/prompt';
import {
  DraftSummary,
  DraftListItem,
  DraftDetail,
  DraftUpdate,
  BulkApproveResult,
  PromptConfigCreate,
  PromptConfigUpdate,
  PromptTestResult,
  YearMonthOption
} from './types';
import { AppLogger } from '../utils/logger';

/**
 * List of fields allowed in DraftUpdate for sanitization.
 * Protected fields (status, reviewedBy, reviewedAt, draftId, version, etc.)
 * must be managed through dedicated methods to ensure proper audit trail
 * tracking for 電子帳簿保存法 compliance.
 */
const ALLOWED_DRAFT_UPDATE_FIELDS = [
  'vendorName',
  'serviceName',
  'amount',
  'taxAmount',
  'issueDate',
  'dueDate',
  'eventMonth',
  'paymentMonth',
  'selectedEntry',
  'notes'
] as const;

/**
 * Sanitize DraftUpdate object to only include allowed fields.
 * This prevents injection of protected fields like status, reviewedBy, reviewedAt, etc.
 * which must be managed through dedicated methods (updateStatus, selectSuggestion, etc.)
 * to ensure proper audit trail tracking for 電子帳簿保存法 compliance.
 *
 * @param input - The raw input object (potentially containing unauthorized fields)
 * @returns A sanitized DraftUpdate with only allowed fields
 */
export function sanitizeDraftUpdate(input: unknown): DraftUpdate {
  if (typeof input !== 'object' || input === null) {
    return {};
  }

  const sanitized: DraftUpdate = {};
  for (const field of ALLOWED_DRAFT_UPDATE_FIELDS) {
    if (field in input) {
      (sanitized as Record<string, unknown>)[field] = (input as Record<string, unknown>)[field];
    }
  }
  return sanitized;
}

/**
 * Configuration for WebAppApi
 */
export interface WebAppApiConfig {
  spreadsheetId: string;
  geminiApiKey?: string;
}

export class WebAppApi {
  private draftManager: DraftSheetManager;
  private dictionaryManager: DictionarySheetManager;
  private draftHistoryManager: DraftHistorySheetManager;
  private dictHistoryManager: DictionaryHistorySheetManager;
  private promptService: PromptService;
  private journalGenerator: JournalGenerator | null = null;

  constructor(config: WebAppApiConfig) {
    this.draftManager = new DraftSheetManager(config.spreadsheetId);
    this.dictionaryManager = new DictionarySheetManager(config.spreadsheetId);
    this.draftHistoryManager = new DraftHistorySheetManager(config.spreadsheetId);
    this.dictHistoryManager = new DictionaryHistorySheetManager(config.spreadsheetId);
    this.promptService = new PromptService({ spreadsheetId: config.spreadsheetId });

    if (config.geminiApiKey) {
      this.journalGenerator = new JournalGenerator({
        geminiApiKey: config.geminiApiKey,
        spreadsheetId: config.spreadsheetId
      });
    }
  }

  // ============================================
  // Dashboard APIs
  // ============================================

  /**
   * Get summary statistics for a specific month
   */
  getDraftSummary(yearMonth: string): DraftSummary {
    try {
      const drafts = this.draftManager.getByEventMonth(yearMonth);
      const stats = {
        yearMonth,
        total: drafts.length,
        pending: 0,
        reviewed: 0,
        approved: 0,
        exported: 0,
        totalAmount: 0
      };

      for (const draft of drafts) {
        stats.totalAmount += draft.amount;
        switch (draft.status) {
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
      AppLogger.error('Error getting draft summary', error as Error);
      throw error;
    }
  }

  /**
   * Get list of drafts for display
   */
  getDraftList(yearMonth: string, status?: DraftStatus): DraftListItem[] {
    try {
      let drafts: DraftEntry[];

      if (yearMonth) {
        drafts = this.draftManager.getByEventMonth(yearMonth);
        if (status) {
          drafts = drafts.filter(d => d.status === status);
        }
      } else {
        drafts = this.draftManager.getAll(status);
      }

      return drafts.map(draft => this.toDraftListItem(draft));
    } catch (error) {
      AppLogger.error('Error getting draft list', error as Error);
      throw error;
    }
  }

  /**
   * Get available year-month options
   */
  getYearMonthOptions(): YearMonthOption[] {
    try {
      const allDrafts = this.draftManager.getAll();
      const monthMap = new Map<string, number>();

      for (const draft of allDrafts) {
        const month = draft.eventMonth;
        // Skip invalid eventMonth values
        if (!month || typeof month !== 'string' || !month.includes('-')) {
          continue;
        }
        monthMap.set(month, (monthMap.get(month) || 0) + 1);
      }

      const options: YearMonthOption[] = [];
      for (const [month, count] of monthMap.entries()) {
        options.push({
          value: month,
          label: this.formatYearMonth(month),
          draftCount: count
        });
      }

      // Sort by month descending
      options.sort((a, b) => b.value.localeCompare(a.value));

      return options;
    } catch (error) {
      AppLogger.error('Error getting year-month options', error as Error);
      throw error;
    }
  }

  /**
   * Bulk approve multiple drafts
   */
  bulkApprove(draftIds: string[]): BulkApproveResult {
    const result: BulkApproveResult = {
      success: true,
      approvedCount: 0,
      failedCount: 0,
      errors: []
    };

    const user = this.getCurrentUser();

    for (const draftId of draftIds) {
      try {
        const draft = this.draftManager.getById(draftId);
        if (!draft) {
          result.errors.push({ draftId, error: 'Draft not found' });
          result.failedCount++;
          continue;
        }

        if (!draft.selectedEntry) {
          result.errors.push({ draftId, error: 'No entry selected' });
          result.failedCount++;
          continue;
        }

        this.draftManager.updateStatus(draftId, 'approved', user);
        result.approvedCount++;
      } catch (error) {
        result.errors.push({ draftId, error: (error as Error).message });
        result.failedCount++;
      }
    }

    result.success = result.failedCount === 0;
    return result;
  }

  // ============================================
  // Review APIs
  // ============================================

  /**
   * Get detailed draft information
   */
  getDraftDetail(draftId: string): DraftDetail | null {
    try {
      const draft = this.draftManager.getById(draftId);
      if (!draft) {
        return null;
      }
      return this.toDraftDetail(draft);
    } catch (error) {
      AppLogger.error('Error getting draft detail', error as Error);
      throw error;
    }
  }

  /**
   * Get version history for a draft
   */
  getDraftHistory(draftId: string): DraftHistoryEntry[] {
    try {
      return this.draftHistoryManager.getHistoryByDraftId(draftId);
    } catch (error) {
      AppLogger.error('Error getting draft history', error as Error);
      throw error;
    }
  }

  /**
   * Get snapshot of draft at specific version
   */
  getDraftSnapshot(draftId: string, version: number): Record<string, unknown> | null {
    try {
      return this.draftHistoryManager.getSnapshotAtVersion(draftId, version);
    } catch (error) {
      AppLogger.error('Error getting draft snapshot', error as Error);
      throw error;
    }
  }

  /**
   * Update draft fields
   */
  updateDraft(draftId: string, updates: DraftUpdate, reason?: string): DraftDetail | null {
    try {
      const user = this.getCurrentUser();
      const sanitizedUpdates = sanitizeDraftUpdate(updates);
      const updated = this.draftManager.update(draftId, sanitizedUpdates, reason, user);
      if (!updated) {
        return null;
      }
      return this.toDraftDetail(updated);
    } catch (error) {
      AppLogger.error('Error updating draft', error as Error);
      throw error;
    }
  }

  /**
   * Select a suggestion for a draft
   */
  selectSuggestion(draftId: string, suggestionIndex: number): DraftDetail | null {
    try {
      const draft = this.draftManager.getById(draftId);
      if (!draft || !draft.suggestedEntries) {
        return null;
      }

      const suggestion = draft.suggestedEntries.suggestions[suggestionIndex];
      if (!suggestion) {
        return null;
      }

      const user = this.getCurrentUser();
      const updated = this.draftManager.update(
        draftId,
        {
          selectedEntry: suggestion.entries,
          status: 'reviewed',
          reviewedBy: user,
          reviewedAt: new Date()
        },
        `Selected suggestion ${suggestionIndex + 1}`,
        user
      );

      return updated ? this.toDraftDetail(updated) : null;
    } catch (error) {
      AppLogger.error('Error selecting suggestion', error as Error);
      throw error;
    }
  }

  /**
   * Set custom journal entry
   */
  setCustomEntry(
    draftId: string,
    entries: JournalEntry[],
    reason: string
  ): DraftDetail | null {
    try {
      const user = this.getCurrentUser();
      const updated = this.draftManager.update(
        draftId,
        {
          selectedEntry: entries,
          status: 'reviewed',
          reviewedBy: user,
          reviewedAt: new Date()
        },
        reason || 'Custom entry set',
        user
      );

      return updated ? this.toDraftDetail(updated) : null;
    } catch (error) {
      AppLogger.error('Error setting custom entry', error as Error);
      throw error;
    }
  }

  /**
   * Approve a draft and optionally register to dictionary
   */
  approveDraft(
    draftId: string,
    selectedEntry: JournalEntry[],
    registerToDict: boolean,
    editReason?: string
  ): DraftDetail | null {
    try {
      const user = this.getCurrentUser();

      // Update selected entry if provided
      if (selectedEntry && selectedEntry.length > 0) {
        this.draftManager.update(
          draftId,
          { selectedEntry },
          editReason || 'Entry updated on approval',
          user
        );
      }

      // Approve the draft
      const approved = this.draftManager.updateStatus(draftId, 'approved', user);
      if (!approved) {
        return null;
      }

      // Register to dictionary if requested
      if (registerToDict && this.journalGenerator) {
        this.journalGenerator.learnFromDraft(draftId, user);
      }

      return this.toDraftDetail(approved);
    } catch (error) {
      AppLogger.error('Error approving draft', error as Error);
      throw error;
    }
  }

  /**
   * Get next pending draft after current one
   */
  getNextPendingDraft(currentDraftId: string, yearMonth: string): DraftListItem | null {
    try {
      const drafts = this.draftManager.getByEventMonth(yearMonth)
        .filter(d => d.status === 'pending' && d.draftId !== currentDraftId);

      if (drafts.length === 0) {
        return null;
      }

      return this.toDraftListItem(drafts[0]);
    } catch (error) {
      AppLogger.error('Error getting next pending draft', error as Error);
      throw error;
    }
  }

  // ============================================
  // Dictionary APIs
  // ============================================

  /**
   * Get dictionary history for a specific entry
   */
  getDictionaryHistory(dictId: string): DictionaryHistoryEntry[] {
    try {
      return this.dictHistoryManager.getHistoryByDictId(dictId);
    } catch (error) {
      AppLogger.error('Error getting dictionary history', error as Error);
      throw error;
    }
  }

  /**
   * Get all dictionary entries
   */
  getDictionaryList(): DictionaryEntry[] {
    try {
      return this.dictionaryManager.getAll();
    } catch (error) {
      AppLogger.error('Error getting dictionary list', error as Error);
      throw error;
    }
  }

  // ============================================
  // Prompt Management APIs
  // ============================================

  /**
   * Get all prompts
   */
  getPromptList(): PromptConfig[] {
    try {
      return this.promptService.getAll();
    } catch (error) {
      AppLogger.error('Error getting prompt list', error as Error);
      throw error;
    }
  }

  /**
   * Get prompt by ID
   */
  getPromptDetail(promptId: string): PromptConfig | null {
    try {
      return this.promptService.getById(promptId);
    } catch (error) {
      AppLogger.error('Error getting prompt detail', error as Error);
      throw error;
    }
  }

  /**
   * Create new prompt
   */
  createPrompt(config: PromptConfigCreate): PromptConfig {
    try {
      const user = this.getCurrentUser();
      return this.promptService.savePrompt(
        config.promptName,
        config.promptType,
        config.promptText,
        user,
        config.notes
      );
    } catch (error) {
      AppLogger.error('Error creating prompt', error as Error);
      throw error;
    }
  }

  /**
   * Update existing prompt (creates new version)
   */
  updatePrompt(promptId: string, updates: PromptConfigUpdate): PromptConfig | null {
    try {
      const existing = this.promptService.getById(promptId);
      if (!existing) {
        return null;
      }

      const user = this.getCurrentUser();
      return this.promptService.savePrompt(
        updates.promptName || existing.promptName,
        existing.promptType,
        updates.promptText || existing.promptText,
        user,
        updates.notes
      );
    } catch (error) {
      AppLogger.error('Error updating prompt', error as Error);
      throw error;
    }
  }

  /**
   * Activate a prompt
   */
  activatePrompt(promptId: string): PromptConfig | null {
    try {
      return this.promptService.activatePrompt(promptId);
    } catch (error) {
      AppLogger.error('Error activating prompt', error as Error);
      throw error;
    }
  }

  /**
   * Deactivate a prompt (revert to default)
   */
  deactivatePrompt(promptId: string): PromptConfig | null {
    try {
      return this.promptService.deactivatePrompt(promptId);
    } catch (error) {
      AppLogger.error('Error deactivating prompt', error as Error);
      throw error;
    }
  }

  /**
   * Delete a prompt (only inactive prompts can be deleted)
   */
  deletePrompt(promptId: string): void {
    try {
      const prompt = this.promptService.getById(promptId);
      if (!prompt) {
        throw new Error('Prompt not found');
      }
      if (prompt.isActive) {
        throw new Error('Cannot delete active prompt. Deactivate it first.');
      }
      this.promptService.delete(promptId);
      AppLogger.info(`Deleted prompt: ${promptId}`);
    } catch (error) {
      AppLogger.error('Error deleting prompt', error as Error);
      throw error;
    }
  }

  /**
   * Test a prompt with sample data
   */
  testPrompt(promptId: string, testFileId: string): PromptTestResult {
    try {
      const prompt = this.promptService.getById(promptId);
      if (!prompt) {
        return { success: false, error: 'Prompt not found' };
      }

      // Get sample variables from the test file
      const variables = this.getSampleVariables(testFileId);

      // Test the prompt
      const result = this.promptService.testPrompt(prompt.promptText, variables);

      return {
        success: result.success,
        renderedPrompt: result.response,
        error: result.error,
        executionTimeMs: result.executionTimeMs
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get version history for a prompt type
   */
  getPromptVersionHistory(promptType: PromptType): PromptConfig[] {
    try {
      return this.promptService.getVersionHistory(promptType);
    } catch (error) {
      AppLogger.error('Error getting prompt version history', error as Error);
      throw error;
    }
  }

  /**
   * Reset prompt to default
   */
  resetToDefaultPrompt(promptType: PromptType): void {
    try {
      // Deactivate all prompts of this type
      const prompts = this.promptService.getVersionHistory(promptType);
      for (const prompt of prompts) {
        if (prompt.isActive) {
          this.promptService.deactivatePrompt(prompt.promptId);
        }
      }
    } catch (error) {
      AppLogger.error('Error resetting prompt to default', error as Error);
      throw error;
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Get current user email
   */
  private getCurrentUser(): string {
    try {
      return Session.getActiveUser().getEmail() || 'anonymous';
    } catch {
      return 'anonymous';
    }
  }

  /**
   * Convert DraftEntry to DraftListItem
   */
  private toDraftListItem(draft: DraftEntry): DraftListItem {
    const suggestions = draft.suggestedEntries?.suggestions || [];
    return {
      draftId: draft.draftId,
      vendorName: draft.vendorName,
      serviceName: draft.serviceName,
      amount: draft.amount,
      taxAmount: draft.taxAmount,
      docType: draft.docType,
      issueDate: draft.issueDate,
      eventMonth: draft.eventMonth,
      status: draft.status,
      hasSelectedEntry: draft.selectedEntry !== null,
      suggestionCount: suggestions.length,
      topConfidence: suggestions.length > 0 ? suggestions[0].confidence : 0,
      updatedAt: draft.updatedAt.toISOString()
    };
  }

  /**
   * Convert DraftEntry to DraftDetail
   */
  private toDraftDetail(draft: DraftEntry): DraftDetail {
    return {
      draftId: draft.draftId,
      fileId: draft.fileId,
      fileName: draft.fileName,
      filePath: draft.filePath,
      docType: draft.docType,
      storageType: draft.storageType,
      vendorName: draft.vendorName,
      serviceName: draft.serviceName,
      amount: draft.amount,
      taxAmount: draft.taxAmount,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      eventMonth: draft.eventMonth,
      paymentMonth: draft.paymentMonth,
      suggestions: draft.suggestedEntries?.suggestions || [],
      selectedEntry: draft.selectedEntry,
      dictionaryMatchId: draft.dictionaryMatchId,
      status: draft.status,
      reviewedBy: draft.reviewedBy,
      reviewedAt: draft.reviewedAt?.toISOString() || null,
      notes: draft.notes,
      version: draft.version,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString()
    };
  }

  /**
   * Format year-month for display
   */
  private formatYearMonth(yearMonth: string): string {
    if (!yearMonth || typeof yearMonth !== 'string' || !yearMonth.includes('-')) {
      return yearMonth || '不明';
    }
    const [year, month] = yearMonth.split('-');
    return `${year}年${parseInt(month)}月`;
  }

  /**
   * Get sample variables for prompt testing
   */
  private getSampleVariables(testFileId: string): Record<string, string> {
    try {
      // Try to get draft by fileId
      const allDrafts = this.draftManager.getAll();
      const draft = allDrafts.find(d => d.fileId === testFileId);

      if (draft) {
        return {
          vendorName: draft.vendorName,
          serviceName: draft.serviceName,
          amount: String(draft.amount),
          taxAmount: String(draft.taxAmount),
          docType: draft.docType,
          issueDate: draft.issueDate,
          dueDate: draft.dueDate,
          eventMonth: draft.eventMonth
        };
      }

      // Return placeholder variables
      return {
        vendorName: 'サンプル会社',
        serviceName: 'サンプルサービス',
        amount: '10000',
        taxAmount: '1000',
        docType: 'invoice',
        issueDate: '2024-01-15',
        dueDate: '2024-02-15',
        eventMonth: '2024-01'
      };
    } catch {
      return {};
    }
  }
}
