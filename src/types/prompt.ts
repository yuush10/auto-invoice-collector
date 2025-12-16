/**
 * Type definitions for customizable Gemini prompts (Phase 4)
 */

/**
 * Types of prompts used in the system
 */
export type PromptType = 'extraction' | 'suggestion' | 'validation';

/**
 * Prompt configuration entry
 * Represents a single row in the PromptConfigSheet
 */
export interface PromptConfig {
  promptId: string;
  promptName: string;
  promptType: PromptType;
  promptText: string;
  isActive: boolean;
  version: number;
  createdAt: Date;
  createdBy: string;
  notes: string;
}

/**
 * Column definitions for PromptConfigSheet
 */
export const PROMPT_CONFIG_COLUMNS = [
  'prompt_id',
  'prompt_name',
  'prompt_type',
  'prompt_text',
  'is_active',
  'version',
  'created_at',
  'created_by',
  'notes'
] as const;

export type PromptConfigColumn = typeof PROMPT_CONFIG_COLUMNS[number];

/**
 * Template variables that can be used in prompts
 */
export interface PromptTemplateVariables {
  vendorName?: string;
  serviceName?: string;
  amount?: number;
  taxAmount?: number;
  docType?: string;
  issueDate?: string;
  dueDate?: string;
  eventMonth?: string;
  dictionaryContext?: string;
  customContext?: string;
}

/**
 * Result of prompt execution
 */
export interface PromptExecutionResult {
  success: boolean;
  response?: string;
  parsedData?: Record<string, unknown>;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Default prompt identifiers
 */
export const DEFAULT_PROMPT_IDS = {
  EXTRACTION: 'default-extraction',
  SUGGESTION: 'default-suggestion',
  VALIDATION: 'default-validation'
} as const;
