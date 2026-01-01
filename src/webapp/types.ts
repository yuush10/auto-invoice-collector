/**
 * Type definitions for Web App API requests and responses
 */

import { DraftStatus, JournalEntry, JournalEntrySuggestion } from '../types/journal';
import { PromptType } from '../types/prompt';
import { DocumentType } from '../types';

/**
 * Summary statistics for draft entries
 */
export interface DraftSummary {
  yearMonth: string;
  total: number;
  pending: number;
  reviewed: number;
  approved: number;
  exported: number;
  totalAmount: number;
}

/**
 * List item for draft display (lightweight version)
 */
export interface DraftListItem {
  draftId: string;
  vendorName: string;
  serviceName: string;
  amount: number;
  taxAmount: number;
  docType: DocumentType;
  issueDate: string;
  eventMonth: string;
  status: DraftStatus;
  hasSelectedEntry: boolean;
  suggestionCount: number;
  topConfidence: number;
  updatedAt: string;
}

/**
 * Detailed draft information for review screen
 */
export interface DraftDetail {
  draftId: string;
  fileId: string;
  fileName: string;
  filePath: string;
  docType: DocumentType;
  storageType: 'electronic' | 'paper_scan';
  vendorName: string;
  serviceName: string;
  amount: number;
  taxAmount: number;
  issueDate: string;
  dueDate: string;
  eventMonth: string;
  paymentMonth: string;
  suggestions: JournalEntrySuggestion[];
  selectedEntry: JournalEntry[] | null;
  dictionaryMatchId: string;
  status: DraftStatus;
  reviewedBy: string;
  reviewedAt: string | null;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Update payload for draft
 */
export interface DraftUpdate {
  vendorName?: string;
  serviceName?: string;
  amount?: number;
  taxAmount?: number;
  issueDate?: string;
  dueDate?: string;
  eventMonth?: string;
  paymentMonth?: string;
  selectedEntry?: JournalEntry[];
  notes?: string;
}

/**
 * Request for approving a draft
 */
export interface ApproveRequest {
  draftId: string;
  selectedEntry: JournalEntry[];
  registerToDict: boolean;
  editReason?: string;
}

/**
 * Result of approving a draft
 * Includes the approved draft and any warnings that occurred during processing
 */
export interface ApproveResult {
  draft: DraftDetail;
  warnings?: string[];
}

/**
 * Result of bulk approve operation
 */
export interface BulkApproveResult {
  success: boolean;
  approvedCount: number;
  failedCount: number;
  errors: Array<{ draftId: string; error: string }>;
}

/**
 * Prompt configuration for update
 */
export interface PromptConfigUpdate {
  promptName?: string;
  promptText?: string;
  notes?: string;
}

/**
 * Prompt configuration for creation
 */
export interface PromptConfigCreate {
  promptName: string;
  promptType: PromptType;
  promptText: string;
  notes?: string;
}

/**
 * Result of prompt test execution
 */
export interface PromptTestResult {
  success: boolean;
  renderedPrompt?: string;
  response?: string;
  error?: string;
  executionTimeMs?: number;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Year-month options for dropdown
 */
export interface YearMonthOption {
  value: string;
  label: string;
  draftCount: number;
}
