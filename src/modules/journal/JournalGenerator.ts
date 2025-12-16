/**
 * JournalGenerator Service
 * Orchestrates the journal entry generation process:
 * 1. Extract journal info from PDF via Gemini
 * 2. Look up dictionary for learned patterns
 * 3. Get journal entry suggestions
 * 4. Create draft entries for review
 */

import { GeminiOcrService } from '../ocr/GeminiOcrService';
import { DraftSheetManager } from './DraftSheetManager';
import { DictionarySheetManager } from './DictionarySheetManager';
import {
  ExtractedJournalInfo,
  JournalEntrySuggestion,
  DictionaryMatchResult,
  DraftEntry,
  DictionaryEntry,
  SuggestedEntries
} from '../../types/journal';
import { DocumentType } from '../../types';
import { AppLogger } from '../../utils/logger';

/**
 * Configuration for JournalGenerator
 */
export interface JournalGeneratorConfig {
  geminiApiKey: string;
  spreadsheetId: string;
  draftSheetName?: string;
  dictionarySheetName?: string;
  draftHistorySheetName?: string;
  dictionaryHistorySheetName?: string;
  confidenceThreshold?: number;
}

/**
 * Input for journal generation
 */
export interface JournalGenerationInput {
  pdfBlob: GoogleAppsScript.Base.Blob;
  fileId: string;
  fileName: string;
  filePath: string;
  emailFrom: string;
  emailSubject: string;
  storageType?: 'electronic' | 'paper_scan';
}

/**
 * Result of journal generation
 */
export interface JournalGenerationResult {
  success: boolean;
  draftEntry?: DraftEntry;
  extractedInfo?: ExtractedJournalInfo;
  suggestions?: JournalEntrySuggestion[];
  dictionaryMatch?: DictionaryMatchResult;
  error?: string;
}

export class JournalGenerator {
  private geminiService: GeminiOcrService;
  private draftManager: DraftSheetManager;
  private dictionaryManager: DictionarySheetManager;
  private confidenceThreshold: number;

  constructor(config: JournalGeneratorConfig) {
    this.geminiService = new GeminiOcrService(config.geminiApiKey);
    this.draftManager = new DraftSheetManager(config.spreadsheetId);
    this.dictionaryManager = new DictionarySheetManager(config.spreadsheetId);
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
  }

  /**
   * Generate journal entry from PDF
   * Main orchestration method
   */
  generate(input: JournalGenerationInput): JournalGenerationResult {
    try {
      AppLogger.info(`Starting journal generation for: ${input.fileName}`);

      // Step 1: Look up dictionary for context
      const dictionaryContext = this.buildDictionaryContext(input.emailFrom);

      // Step 2: Extract journal info from PDF
      const extractedInfo = this.geminiService.extractJournalInfo(
        input.pdfBlob,
        { from: input.emailFrom, subject: input.emailSubject },
        dictionaryContext
      );

      // Step 3: Match against dictionary
      const dictionaryMatch = this.matchDictionary(extractedInfo);

      // Step 4: Get journal entry suggestions
      const suggestions = this.getSuggestions(extractedInfo, dictionaryMatch);

      // Step 5: Create draft entry
      const draftEntry = this.createDraftEntry(
        input,
        extractedInfo,
        suggestions,
        dictionaryMatch
      );

      // Step 6: Update dictionary usage if matched
      if (dictionaryMatch.matched && dictionaryMatch.dictEntry) {
        this.updateDictionaryUsage(dictionaryMatch.dictEntry.dictId);
      }

      AppLogger.info(`Journal generation complete: ${draftEntry.draftId}`);

      return {
        success: true,
        draftEntry,
        extractedInfo,
        suggestions,
        dictionaryMatch
      };
    } catch (error) {
      AppLogger.error('Error in journal generation', error as Error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Build dictionary context string for Gemini prompt
   */
  private buildDictionaryContext(emailFrom: string): string | undefined {
    try {
      // Extract domain from email
      const domain = emailFrom.match(/@([^>]+)/)?.[1] || '';

      // Search dictionary for vendor aliases matching the domain
      const allEntries = this.dictionaryManager.findByVendor(domain);
      if (allEntries.length === 0) {
        return undefined;
      }

      // Build context from top matches
      const contextLines = allEntries.slice(0, 3).map((entry: DictionaryEntry) => {
        return `- ${entry.vendorName}/${entry.serviceName}: ${entry.defaultAccount} (${entry.defaultTaxClass})`;
      });

      return contextLines.join('\n');
    } catch (error) {
      AppLogger.warn(`Failed to build dictionary context: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Match extracted info against dictionary
   */
  private matchDictionary(extractedInfo: ExtractedJournalInfo): DictionaryMatchResult {
    try {
      const vendorName = extractedInfo.issuerName.value;
      const serviceName = extractedInfo.serviceName.value;

      // Try best match (exact vendor+service or vendor only)
      const bestMatch = this.dictionaryManager.findBestMatch(
        vendorName,
        serviceName
      );

      if (bestMatch) {
        // Determine match type based on whether service also matched
        const serviceMatched = bestMatch.serviceName.toLowerCase() === serviceName.toLowerCase() ||
          bestMatch.serviceAliases.some((alias: string) =>
            alias.toLowerCase() === serviceName.toLowerCase()
          );

        return {
          matched: true,
          dictEntry: bestMatch,
          confidence: serviceMatched ? 1.0 : 0.8,
          matchType: serviceMatched ? 'exact' : 'fuzzy'
        };
      }

      // Try alias match via vendor search
      const aliasMatches = this.dictionaryManager.findByVendor(vendorName);
      if (aliasMatches.length > 0) {
        // Find best service match from vendor matches
        for (const entry of aliasMatches) {
          if (entry.serviceAliases.some((alias: string) =>
            serviceName.toLowerCase().includes(alias.toLowerCase())
          )) {
            return {
              matched: true,
              dictEntry: entry,
              confidence: 0.9,
              matchType: 'alias'
            };
          }
        }

        // Return first vendor match if no service match
        return {
          matched: true,
          dictEntry: aliasMatches[0],
          confidence: 0.7,
          matchType: 'fuzzy'
        };
      }

      return {
        matched: false,
        confidence: 0,
        matchType: 'none'
      };
    } catch (error) {
      AppLogger.warn(`Dictionary match failed: ${(error as Error).message}`);
      return {
        matched: false,
        confidence: 0,
        matchType: 'none'
      };
    }
  }

  /**
   * Get journal entry suggestions from Gemini
   */
  private getSuggestions(
    extractedInfo: ExtractedJournalInfo,
    dictionaryMatch: DictionaryMatchResult
  ): JournalEntrySuggestion[] {
    try {
      // Build dictionary context for suggestion prompt
      let dictionaryContext: string | undefined;
      if (dictionaryMatch.matched && dictionaryMatch.dictEntry) {
        const entry = dictionaryMatch.dictEntry;
        dictionaryContext = `過去パターン:
- 勘定科目: ${entry.defaultAccount}
- 補助科目: ${entry.defaultSubAccount || 'なし'}
- 税区分: ${entry.defaultTaxClass}
- 前払い: ${entry.isPrepaid ? 'はい' : 'いいえ'}`;
      }

      // Convert extracted info to JSON for prompt
      const extractedDataJson = JSON.stringify({
        vendor_name: extractedInfo.issuerName.value,
        service_name: extractedInfo.serviceName.value,
        doc_type: extractedInfo.docType.value,
        total_amount: extractedInfo.totalAmount.value,
        total_tax_amount: extractedInfo.totalTaxAmount.value,
        transaction_date: extractedInfo.transactionDate.value,
        event_month: extractedInfo.eventMonth.value,
        is_reduced_tax_rate: extractedInfo.isReducedTaxRate.value,
        applicable_tax_rates: extractedInfo.applicableTaxRates.value,
        invoice_registration_number: extractedInfo.invoiceRegistrationNumber.value
      }, null, 2);

      return this.geminiService.getJournalSuggestions(
        extractedDataJson,
        dictionaryContext
      );
    } catch (error) {
      AppLogger.warn(`Failed to get suggestions: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Create draft entry from extracted data
   */
  private createDraftEntry(
    input: JournalGenerationInput,
    extractedInfo: ExtractedJournalInfo,
    suggestions: JournalEntrySuggestion[],
    dictionaryMatch: DictionaryMatchResult
  ): DraftEntry {
    const suggestedEntries: SuggestedEntries = {
      suggestions
    };

    // Select best suggestion if confidence is high enough
    let selectedEntry = null;
    if (suggestions.length > 0 && suggestions[0].confidence >= this.confidenceThreshold) {
      selectedEntry = suggestions[0].entries;
    }

    // Calculate payment month from due date or transaction date
    const paymentMonth = extractedInfo.dueDate.value
      ? extractedInfo.dueDate.value.substring(0, 7)
      : extractedInfo.transactionDate.value.substring(0, 7);

    const draftData = {
      fileId: input.fileId,
      fileName: input.fileName,
      filePath: input.filePath,
      docType: extractedInfo.docType.value as DocumentType,
      storageType: input.storageType || 'electronic' as const,
      vendorName: extractedInfo.issuerName.value,
      serviceName: extractedInfo.serviceName.value,
      amount: extractedInfo.totalAmount.value,
      taxAmount: extractedInfo.totalTaxAmount.value,
      issueDate: extractedInfo.transactionDate.value,
      dueDate: extractedInfo.dueDate.value || '',
      eventMonth: extractedInfo.eventMonth.value,
      paymentMonth,
      suggestedEntries,
      selectedEntry,
      dictionaryMatchId: dictionaryMatch.dictEntry?.dictId || '',
      status: 'pending' as const,
      reviewedBy: '',
      reviewedAt: null,
      notes: extractedInfo.notes
    };

    return this.draftManager.create(draftData, 'system');
  }

  /**
   * Update dictionary entry usage count
   */
  private updateDictionaryUsage(dictId: string): void {
    try {
      const entry = this.dictionaryManager.getById(dictId);
      if (entry) {
        this.dictionaryManager.update(
          dictId,
          {
            useCount: entry.useCount + 1,
            lastUsedAt: new Date()
          },
          'Auto-increment usage count',
          'system'
        );
      }
    } catch (error) {
      AppLogger.warn(`Failed to update dictionary usage: ${(error as Error).message}`);
    }
  }

  /**
   * Regenerate suggestions for an existing draft
   */
  regenerateSuggestions(draftId: string): JournalGenerationResult {
    try {
      const draft = this.draftManager.getById(draftId);
      if (!draft) {
        return {
          success: false,
          error: `Draft not found: ${draftId}`
        };
      }

      // Get file from Drive
      const file = DriveApp.getFileById(draft.fileId);
      const pdfBlob = file.getBlob();

      // Re-extract and regenerate
      return this.generate({
        pdfBlob,
        fileId: draft.fileId,
        fileName: draft.fileName,
        filePath: draft.filePath,
        emailFrom: draft.vendorName,
        emailSubject: draft.serviceName,
        storageType: draft.storageType
      });
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Update draft with user-selected entry
   */
  selectEntry(
    draftId: string,
    suggestionIndex: number,
    reviewedBy: string
  ): DraftEntry | null {
    const draft = this.draftManager.getById(draftId);
    if (!draft || !draft.suggestedEntries) {
      return null;
    }

    const suggestion = draft.suggestedEntries.suggestions[suggestionIndex];
    if (!suggestion) {
      return null;
    }

    return this.draftManager.update(
      draftId,
      {
        selectedEntry: suggestion.entries,
        status: 'reviewed',
        reviewedBy,
        reviewedAt: new Date()
      },
      `Selected suggestion ${suggestionIndex + 1}`,
      reviewedBy
    );
  }

  /**
   * Approve a draft entry for export
   */
  approveDraft(draftId: string, approvedBy: string): DraftEntry | null {
    return this.draftManager.updateStatus(draftId, 'approved', approvedBy);
  }

  /**
   * Learn from approved draft and add to dictionary
   */
  learnFromDraft(draftId: string, createdBy: string): DictionaryEntry | null {
    try {
      const draft = this.draftManager.getById(draftId);
      if (!draft || !draft.selectedEntry || draft.status !== 'approved') {
        return null;
      }

      // Check if already in dictionary
      const existing = this.dictionaryManager.findBestMatch(
        draft.vendorName,
        draft.serviceName
      );
      if (existing) {
        return existing;
      }

      // Extract account info from selected entry
      const firstEntry = draft.selectedEntry[0];
      if (!firstEntry) {
        return null;
      }

      const newEntry = {
        vendorName: draft.vendorName,
        serviceName: draft.serviceName,
        vendorAliases: [],
        serviceAliases: [],
        docType: draft.docType,
        defaultAccount: firstEntry.debit.accountName,
        defaultSubAccount: firstEntry.debit.subAccountName || '',
        defaultTaxClass: firstEntry.debit.taxClass || '',
        defaultDepartment: firstEntry.debit.departmentName || '',
        paymentMethod: 'bank' as const,
        paymentAccount: firstEntry.credit.accountName,
        paymentSubAccount: firstEntry.credit.subAccountName || '',
        isPrepaid: false,
        prepaidAccount: '',
        expenseTiming: 'usage' as const,
        tags: [],
        descriptionTemplate: firstEntry.description || '',
        confidenceThreshold: 0.8,
        useCount: 1,
        lastUsedAt: new Date()
      };

      return this.dictionaryManager.create(newEntry, createdBy);
    } catch (error) {
      AppLogger.error('Error learning from draft', error as Error);
      return null;
    }
  }
}
