/**
 * DictionaryService
 * Provides high-level dictionary operations with fuzzy matching and learning capabilities
 */

import { DictionarySheetManager } from './DictionarySheetManager';
import {
  DictionaryEntry,
  DictionaryMatchResult
} from '../../types/journal';
import { DocumentType } from '../../types';
import { AppLogger } from '../../utils/logger';

/**
 * Match score for ranking dictionary matches
 */
interface MatchScore {
  entry: DictionaryEntry;
  score: number;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'partial';
  matchedField: string;
}

/**
 * Configuration for DictionaryService
 */
export interface DictionaryServiceConfig {
  spreadsheetId: string;
  dictionarySheetName?: string;
  dictionaryHistorySheetName?: string;
  fuzzyThreshold?: number;
}

export class DictionaryService {
  private manager: DictionarySheetManager;
  private fuzzyThreshold: number;

  constructor(config: DictionaryServiceConfig) {
    this.manager = new DictionarySheetManager(config.spreadsheetId);
    this.fuzzyThreshold = config.fuzzyThreshold ?? 0.6;
  }

  /**
   * Find best matching dictionary entry
   */
  findBestMatch(
    vendorName: string,
    serviceName: string,
    docType?: DocumentType
  ): DictionaryMatchResult {
    try {
      const scores = this.calculateMatchScores(vendorName, serviceName);

      // Filter by doc type if specified
      const filtered = docType
        ? scores.filter(s => s.entry.docType === docType || s.entry.docType === 'unknown')
        : scores;

      if (filtered.length === 0) {
        return {
          matched: false,
          confidence: 0,
          matchType: 'none'
        };
      }

      // Sort by score descending
      filtered.sort((a, b) => b.score - a.score);
      const best = filtered[0];

      // Check threshold
      if (best.score < this.fuzzyThreshold) {
        return {
          matched: false,
          confidence: best.score,
          matchType: 'none'
        };
      }

      return {
        matched: true,
        dictEntry: best.entry,
        confidence: best.score,
        matchType: best.matchType === 'exact' ? 'exact' :
                   best.matchType === 'alias' ? 'alias' : 'fuzzy'
      };
    } catch (error) {
      AppLogger.warn(`Dictionary match error: ${(error as Error).message}`);
      return {
        matched: false,
        confidence: 0,
        matchType: 'none'
      };
    }
  }

  /**
   * Calculate match scores for all dictionary entries
   */
  private calculateMatchScores(vendorName: string, serviceName: string): MatchScore[] {
    const allEntries = this.manager.getAll();
    const scores: MatchScore[] = [];
    const vendorLower = vendorName.toLowerCase();
    const serviceLower = serviceName.toLowerCase();

    for (const entry of allEntries) {
      let bestScore = 0;
      let matchType: MatchScore['matchType'] = 'partial';
      let matchedField = '';

      // Exact vendor match
      if (entry.vendorName.toLowerCase() === vendorLower) {
        if (entry.serviceName.toLowerCase() === serviceLower) {
          bestScore = 1.0;
          matchType = 'exact';
          matchedField = 'vendor+service';
        } else {
          bestScore = Math.max(bestScore, 0.8);
          matchType = 'partial';
          matchedField = 'vendor';
        }
      }

      // Check vendor aliases
      for (const alias of entry.vendorAliases) {
        if (alias.toLowerCase() === vendorLower) {
          if (entry.serviceName.toLowerCase() === serviceLower) {
            bestScore = Math.max(bestScore, 0.95);
            matchType = bestScore === 0.95 ? 'alias' : matchType;
            matchedField = 'vendorAlias+service';
          } else {
            bestScore = Math.max(bestScore, 0.75);
            matchedField = 'vendorAlias';
          }
        }
      }

      // Check service aliases
      for (const alias of entry.serviceAliases) {
        if (alias.toLowerCase() === serviceLower) {
          if (entry.vendorName.toLowerCase() === vendorLower) {
            bestScore = Math.max(bestScore, 0.95);
            matchType = bestScore === 0.95 ? 'alias' : matchType;
            matchedField = 'vendor+serviceAlias';
          } else {
            bestScore = Math.max(bestScore, 0.7);
            matchedField = 'serviceAlias';
          }
        }
      }

      // Fuzzy vendor match (contains)
      if (bestScore < 0.7) {
        if (vendorLower.includes(entry.vendorName.toLowerCase()) ||
            entry.vendorName.toLowerCase().includes(vendorLower)) {
          const similarity = this.calculateSimilarity(
            vendorLower,
            entry.vendorName.toLowerCase()
          );
          if (similarity > bestScore) {
            bestScore = similarity * 0.8; // Discount fuzzy matches
            matchType = 'fuzzy';
            matchedField = 'vendor(fuzzy)';
          }
        }
      }

      if (bestScore > 0) {
        scores.push({
          entry,
          score: bestScore,
          matchType,
          matchedField
        });
      }
    }

    return scores;
  }

  /**
   * Calculate string similarity (Jaccard-like)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    // Tokenize
    const tokens1 = new Set(str1.split(/\s+/));
    const tokens2 = new Set(str2.split(/\s+/));

    // Calculate Jaccard similarity
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  }

  /**
   * Add alias to existing dictionary entry
   */
  addVendorAlias(
    dictId: string,
    alias: string,
    changedBy: string
  ): DictionaryEntry | null {
    const entry = this.manager.getById(dictId);
    if (!entry) {
      return null;
    }

    // Check if alias already exists
    if (entry.vendorAliases.includes(alias)) {
      return entry;
    }

    const updatedAliases = [...entry.vendorAliases, alias];
    return this.manager.update(
      dictId,
      { vendorAliases: updatedAliases },
      `Added vendor alias: ${alias}`,
      changedBy
    );
  }

  /**
   * Add service alias to existing dictionary entry
   */
  addServiceAlias(
    dictId: string,
    alias: string,
    changedBy: string
  ): DictionaryEntry | null {
    const entry = this.manager.getById(dictId);
    if (!entry) {
      return null;
    }

    if (entry.serviceAliases.includes(alias)) {
      return entry;
    }

    const updatedAliases = [...entry.serviceAliases, alias];
    return this.manager.update(
      dictId,
      { serviceAliases: updatedAliases },
      `Added service alias: ${alias}`,
      changedBy
    );
  }

  /**
   * Create new dictionary entry from user correction
   */
  learnFromCorrection(
    vendorName: string,
    serviceName: string,
    accountName: string,
    subAccountName: string,
    taxClass: string,
    docType: DocumentType,
    createdBy: string
  ): DictionaryEntry {
    // Check for existing entry
    const existing = this.manager.findBestMatch(vendorName, serviceName);
    if (existing) {
      // Update existing entry
      return this.manager.update(
        existing.dictId,
        {
          defaultAccount: accountName,
          defaultSubAccount: subAccountName,
          defaultTaxClass: taxClass
        },
        'Updated from user correction',
        createdBy
      ) || existing;
    }

    // Create new entry
    return this.manager.create({
      vendorName,
      serviceName,
      vendorAliases: [],
      serviceAliases: [],
      docType,
      defaultAccount: accountName,
      defaultSubAccount: subAccountName,
      defaultTaxClass: taxClass,
      defaultDepartment: '',
      paymentMethod: 'bank',
      paymentAccount: '未払金',
      paymentSubAccount: '',
      isPrepaid: false,
      prepaidAccount: '',
      expenseTiming: 'usage',
      tags: [],
      descriptionTemplate: '',
      confidenceThreshold: 0.8
    }, createdBy);
  }

  /**
   * Get frequently used dictionary entries
   */
  getFrequentlyUsed(limit: number = 10): DictionaryEntry[] {
    const all = this.manager.getAll();
    return all
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  /**
   * Get recently used dictionary entries
   */
  getRecentlyUsed(limit: number = 10): DictionaryEntry[] {
    const all = this.manager.getAll();
    return all
      .filter(e => e.lastUsedAt !== null)
      .sort((a, b) => {
        const aTime = a.lastUsedAt?.getTime() || 0;
        const bTime = b.lastUsedAt?.getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  /**
   * Search dictionary entries by keyword
   */
  search(keyword: string): DictionaryEntry[] {
    const all = this.manager.getAll();
    const keywordLower = keyword.toLowerCase();

    return all.filter(entry =>
      entry.vendorName.toLowerCase().includes(keywordLower) ||
      entry.serviceName.toLowerCase().includes(keywordLower) ||
      entry.vendorAliases.some(a => a.toLowerCase().includes(keywordLower)) ||
      entry.serviceAliases.some(a => a.toLowerCase().includes(keywordLower)) ||
      entry.defaultAccount.toLowerCase().includes(keywordLower)
    );
  }

  /**
   * Get all dictionary entries
   */
  getAll(): DictionaryEntry[] {
    return this.manager.getAll();
  }

  /**
   * Get dictionary entry by ID
   */
  getById(dictId: string): DictionaryEntry | null {
    return this.manager.getById(dictId);
  }

  /**
   * Delete dictionary entry
   */
  delete(dictId: string, deletedBy: string): boolean {
    return this.manager.delete(dictId, deletedBy);
  }

  /**
   * Get entry history for audit
   */
  getHistory(dictId: string) {
    return this.manager.getHistory(dictId);
  }

  /**
   * Build context string for Gemini prompt from matched entries
   */
  buildPromptContext(matches: DictionaryEntry[]): string {
    if (matches.length === 0) {
      return '';
    }

    const lines = matches.map(entry => {
      const parts = [
        `取引先: ${entry.vendorName}`,
        `サービス: ${entry.serviceName}`,
        `勘定科目: ${entry.defaultAccount}`,
        entry.defaultSubAccount ? `補助科目: ${entry.defaultSubAccount}` : null,
        `税区分: ${entry.defaultTaxClass}`,
        entry.isPrepaid ? '前払費用あり' : null
      ].filter(Boolean);

      return `- ${parts.join(', ')}`;
    });

    return lines.join('\n');
  }
}
