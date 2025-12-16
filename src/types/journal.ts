/**
 * Type definitions for journal entry generation (Phase 4)
 */

import { DocumentType } from './index';

/**
 * Storage type for documents
 */
export type StorageType = 'electronic' | 'paper_scan';

/**
 * Draft status for journal entries
 */
export type DraftStatus = 'pending' | 'reviewed' | 'approved' | 'exported';

/**
 * Payment method types
 */
export type PaymentMethod = 'bank' | 'card' | 'cash';

/**
 * Expense timing for when to recognize the expense
 */
export type ExpenseTiming = 'payment' | 'usage' | 'end_of_month';

/**
 * A single line item in a journal entry (debit or credit side)
 */
export interface EntryLine {
  accountName: string;
  subAccountName?: string;
  departmentName?: string;
  taxClass?: string;
  amount: number;
  taxAmount?: number;
}

/**
 * A complete journal entry with debit and credit sides
 */
export interface JournalEntry {
  entryNo: number;
  transactionDate: string;
  debit: EntryLine;
  credit: EntryLine;
  description?: string;
  memo?: string;
  tags?: string[];
}

/**
 * Suggested journal entries from Gemini AI
 */
export interface SuggestedEntries {
  suggestions: JournalEntrySuggestion[];
  rawResponse?: string;
}

/**
 * A single journal entry suggestion with confidence score
 */
export interface JournalEntrySuggestion {
  entries: JournalEntry[];
  confidence: number;
  reasoning?: string;
}

/**
 * Draft sheet row data structure
 * Represents a single row in the DraftSheet
 * Includes version field for 電子帳簿保存法 compliance
 */
export interface DraftEntry {
  draftId: string;
  fileId: string;
  fileName: string;
  filePath: string;
  docType: DocumentType;
  storageType: StorageType;
  vendorName: string;
  serviceName: string;
  amount: number;
  taxAmount: number;
  issueDate: string;
  dueDate: string;
  eventMonth: string;
  paymentMonth: string;
  suggestedEntries: SuggestedEntries | null;
  selectedEntry: JournalEntry[] | null;
  dictionaryMatchId: string;
  status: DraftStatus;
  reviewedBy: string;
  reviewedAt: Date | null;
  notes: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dictionary entry for learned journal patterns
 * Represents a single row in the DictionarySheet
 * Includes version field for 電子帳簿保存法 compliance
 */
export interface DictionaryEntry {
  dictId: string;
  vendorName: string;
  serviceName: string;
  vendorAliases: string[];
  serviceAliases: string[];
  docType: DocumentType;
  defaultAccount: string;
  defaultSubAccount: string;
  defaultTaxClass: string;
  defaultDepartment: string;
  paymentMethod: PaymentMethod;
  paymentAccount: string;
  paymentSubAccount: string;
  isPrepaid: boolean;
  prepaidAccount: string;
  expenseTiming: ExpenseTiming;
  tags: string[];
  descriptionTemplate: string;
  confidenceThreshold: number;
  useCount: number;
  lastUsedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Column definitions for DraftSheet
 * Includes version column for 電子帳簿保存法 compliance
 */
export const DRAFT_SHEET_COLUMNS = [
  'draft_id',
  'file_id',
  'file_name',
  'file_path',
  'doc_type',
  'storage_type',
  'vendor_name',
  'service_name',
  'amount',
  'tax_amount',
  'issue_date',
  'due_date',
  'event_month',
  'payment_month',
  'suggested_entries',
  'selected_entry',
  'dictionary_match_id',
  'status',
  'reviewed_by',
  'reviewed_at',
  'notes',
  'version',
  'created_at',
  'updated_at'
] as const;

/**
 * Column definitions for DictionarySheet
 * Includes version column for 電子帳簿保存法 compliance
 */
export const DICTIONARY_SHEET_COLUMNS = [
  'dict_id',
  'vendor_name',
  'service_name',
  'vendor_aliases',
  'service_aliases',
  'doc_type',
  'default_account',
  'default_sub_account',
  'default_tax_class',
  'default_department',
  'payment_method',
  'payment_account',
  'payment_sub_account',
  'is_prepaid',
  'prepaid_account',
  'expense_timing',
  'tags',
  'description_template',
  'confidence_threshold',
  'use_count',
  'last_used_at',
  'version',
  'created_at',
  'updated_at'
] as const;

export type DraftSheetColumn = typeof DRAFT_SHEET_COLUMNS[number];
export type DictionarySheetColumn = typeof DICTIONARY_SHEET_COLUMNS[number];
