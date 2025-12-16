/**
 * PromptService
 * Manages customizable prompts for Gemini API with versioning
 */

import { PromptConfigSheetManager } from './PromptConfigSheetManager';
import {
  PromptConfig,
  PromptType,
  PromptExecutionResult
} from '../../types/prompt';
import {
  JOURNAL_EXTRACTION_PROMPT,
  JOURNAL_SUGGESTION_PROMPT,
  replaceTemplateVariables
} from '../ocr/JournalExtractionPrompt';
import { AppLogger } from '../../utils/logger';

/**
 * Configuration for PromptService
 */
export interface PromptServiceConfig {
  spreadsheetId: string;
  promptSheetName?: string;
}

/**
 * Template variable values for prompt rendering
 */
export interface PromptVariables {
  [key: string]: string | undefined;
}

export class PromptService {
  private manager: PromptConfigSheetManager;
  private cache: Map<string, PromptConfig> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private lastCacheUpdate: number = 0;

  constructor(config: PromptServiceConfig) {
    this.manager = new PromptConfigSheetManager(config.spreadsheetId);
  }

  /**
   * Get active prompt by type, with caching
   */
  getActivePrompt(type: PromptType): PromptConfig | null {
    this.refreshCacheIfNeeded();

    // Find active prompt of this type in cache
    for (const config of this.cache.values()) {
      if (config.promptType === type && config.isActive) {
        return config;
      }
    }

    // Fall back to direct lookup
    const prompt = this.manager.getActiveByType(type);
    if (prompt) {
      this.cache.set(prompt.promptId, prompt);
    }
    return prompt;
  }

  /**
   * Get prompt text for a specific type
   * Falls back to default if no custom prompt exists
   */
  getPromptText(type: PromptType): string {
    const config = this.getActivePrompt(type);
    if (config) {
      return config.promptText;
    }

    // Return default prompts
    switch (type) {
      case 'extraction':
        return JOURNAL_EXTRACTION_PROMPT;
      case 'suggestion':
        return JOURNAL_SUGGESTION_PROMPT;
      case 'validation':
        return this.getDefaultValidationPrompt();
      default:
        return '';
    }
  }

  /**
   * Render prompt with template variables
   */
  renderPrompt(type: PromptType, variables: PromptVariables): string {
    const template = this.getPromptText(type);
    return replaceTemplateVariables(template, variables);
  }

  /**
   * Create or update a custom prompt
   */
  savePrompt(
    name: string,
    type: PromptType,
    promptText: string,
    createdBy: string,
    notes?: string
  ): PromptConfig {
    // Check for existing prompt with same name and type
    const existing = this.findByNameAndType(name, type);

    if (existing) {
      // Create new version
      return this.createNewVersion(existing, promptText, createdBy, notes);
    }

    // Create new prompt
    const config = this.manager.create({
      promptName: name,
      promptType: type,
      promptText,
      isActive: false, // New prompts start inactive
      createdBy,
      notes: notes || ''
    });

    this.cache.set(config.promptId, config);
    return config;
  }

  /**
   * Find prompt by name and type
   */
  private findByNameAndType(name: string, type: PromptType): PromptConfig | null {
    const allByType = this.manager.getByType(type);
    return allByType.find(p => p.promptName === name) || null;
  }

  /**
   * Create new version of existing prompt
   */
  private createNewVersion(
    existing: PromptConfig,
    newPromptText: string,
    createdBy: string,
    notes?: string
  ): PromptConfig {
    // Deactivate old version
    this.manager.setActive(existing.promptId, false);
    this.cache.delete(existing.promptId);

    // Create new version
    const config = this.manager.create({
      promptName: existing.promptName,
      promptType: existing.promptType,
      promptText: newPromptText,
      isActive: existing.isActive, // Inherit active status
      createdBy,
      notes: notes || `Version ${existing.version + 1}`
    });

    this.cache.set(config.promptId, config);
    return config;
  }

  /**
   * Activate a specific prompt version
   */
  activatePrompt(promptId: string): PromptConfig | null {
    // setActive handles deactivating other prompts of same type
    const success = this.manager.setActive(promptId, true);
    if (!success) {
      return null;
    }

    const activated = this.manager.getById(promptId);
    if (activated) {
      this.cache.set(promptId, activated);
    }
    return activated;
  }

  /**
   * Deactivate a prompt (revert to default)
   */
  deactivatePrompt(promptId: string): PromptConfig | null {
    const success = this.manager.setActive(promptId, false);
    if (!success) {
      return null;
    }

    const deactivated = this.manager.getById(promptId);
    if (deactivated) {
      this.cache.set(promptId, deactivated);
    }
    return deactivated;
  }

  /**
   * Get all prompt versions for a type
   */
  getVersionHistory(type: PromptType): PromptConfig[] {
    return this.manager.getByType(type)
      .sort((a: PromptConfig, b: PromptConfig) => b.version - a.version);
  }

  /**
   * Test a prompt with sample data
   */
  testPrompt(promptText: string, variables: PromptVariables): PromptExecutionResult {
    try {
      const startTime = Date.now();
      const rendered = replaceTemplateVariables(promptText, variables);

      // Validate the rendered prompt has no unresolved variables
      const unresolvedVars = rendered.match(/\{\{[^}]+\}\}/g);
      if (unresolvedVars && unresolvedVars.length > 0) {
        return {
          success: false,
          error: `Unresolved variables: ${unresolvedVars.join(', ')}`,
          executionTimeMs: Date.now() - startTime
        };
      }

      return {
        success: true,
        response: rendered,
        executionTimeMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Initialize default prompts if none exist
   */
  initializeDefaults(createdBy: string): void {
    const types: PromptType[] = ['extraction', 'suggestion', 'validation'];

    for (const type of types) {
      const existing = this.manager.getActiveByType(type);
      if (!existing) {
        // Create default prompt entry
        let promptText: string;
        let name: string;

        switch (type) {
          case 'extraction':
            promptText = JOURNAL_EXTRACTION_PROMPT;
            name = 'Default Extraction Prompt';
            break;
          case 'suggestion':
            promptText = JOURNAL_SUGGESTION_PROMPT;
            name = 'Default Suggestion Prompt';
            break;
          case 'validation':
            promptText = this.getDefaultValidationPrompt();
            name = 'Default Validation Prompt';
            break;
          default:
            continue;
        }

        const config = this.manager.create({
          promptName: name,
          promptType: type,
          promptText,
          isActive: true,
          createdBy,
          notes: 'System default prompt'
        });

        this.cache.set(config.promptId, config);
        AppLogger.info(`Initialized default ${type} prompt`);
      }
    }
  }

  /**
   * Get all prompts
   */
  getAll(): PromptConfig[] {
    return this.manager.getAll();
  }

  /**
   * Get prompt by ID
   */
  getById(promptId: string): PromptConfig | null {
    return this.manager.getById(promptId);
  }

  /**
   * Delete a prompt
   */
  delete(promptId: string): boolean {
    const deleted = this.manager.delete(promptId);
    if (deleted) {
      this.cache.delete(promptId);
    }
    return deleted;
  }

  /**
   * Refresh cache if expired
   */
  private refreshCacheIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.cacheExpiry) {
      this.cache.clear();
      this.lastCacheUpdate = now;
    }
  }

  /**
   * Clear cache (force refresh on next access)
   */
  clearCache(): void {
    this.cache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Default validation prompt
   */
  private getDefaultValidationPrompt(): string {
    return `あなたは日本の経理・会計の専門家です。以下の仕訳を検証してください。

【仕訳データ】
{{JOURNAL_ENTRY}}

【検証項目】
1. 借方・貸方の金額バランス
2. 勘定科目の適切性
3. 税区分の正確性
4. 摘要の適切性

【出力形式】
\`\`\`json
{
  "is_valid": true/false,
  "issues": [
    {
      "severity": "error/warning/info",
      "field": "フィールド名",
      "message": "問題の説明"
    }
  ],
  "suggestions": [
    "改善提案"
  ]
}
\`\`\``;
  }
}
