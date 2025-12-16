/**
 * Journal module exports
 * Phase 4: Journal entry auto-generation
 * Includes version control for 電子帳簿保存法 compliance
 */

// Sheet Managers (low-level data access)
export { DraftSheetManager } from './DraftSheetManager';
export { DraftHistorySheetManager } from './DraftHistorySheetManager';
export { DictionarySheetManager } from './DictionarySheetManager';
export { DictionaryHistorySheetManager } from './DictionaryHistorySheetManager';
export { PromptConfigSheetManager } from './PromptConfigSheetManager';

// Services (high-level business logic)
export { JournalGenerator } from './JournalGenerator';
export type { JournalGeneratorConfig, JournalGenerationInput, JournalGenerationResult } from './JournalGenerator';
export { DictionaryService } from './DictionaryService';
export type { DictionaryServiceConfig } from './DictionaryService';
export { PromptService } from './PromptService';
export type { PromptServiceConfig, PromptVariables } from './PromptService';
