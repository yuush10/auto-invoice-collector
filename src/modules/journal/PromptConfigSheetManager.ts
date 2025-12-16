/**
 * Prompt Config Sheet Manager for customizable Gemini prompts
 * Manages the PromptConfigSheet in Google Sheets for storing prompt configurations
 */

import {
  PromptConfig,
  PromptType,
  PROMPT_CONFIG_COLUMNS,
  DEFAULT_PROMPT_IDS
} from '../../types/prompt';
import { AppLogger } from '../../utils/logger';

const SHEET_NAME = 'PromptConfigSheet';

/**
 * Default prompts for journal entry processing
 */
const DEFAULT_PROMPTS: Omit<PromptConfig, 'createdAt'>[] = [
  {
    promptId: DEFAULT_PROMPT_IDS.EXTRACTION,
    promptName: 'Default Extraction Prompt',
    promptType: 'extraction',
    promptText: `You are an expert at extracting financial information from invoices and receipts.

Extract the following information from the document:
- Vendor name (会社名/取引先名)
- Service/product name (サービス名/商品名)
- Total amount including tax (税込金額)
- Tax amount (消費税額)
- Issue date (発行日)
- Due date if present (支払期限)

Return the data in JSON format:
{
  "vendorName": "string",
  "serviceName": "string",
  "amount": number,
  "taxAmount": number,
  "issueDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null"
}

If any field cannot be determined, use null.`,
    isActive: true,
    version: 1,
    createdBy: 'system',
    notes: 'Default prompt for extracting invoice/receipt data'
  },
  {
    promptId: DEFAULT_PROMPT_IDS.SUGGESTION,
    promptName: 'Default Suggestion Prompt',
    promptType: 'suggestion',
    promptText: `You are an expert Japanese accountant. Generate journal entry suggestions based on the extracted invoice data.

Input data:
- Vendor: {{vendorName}}
- Service: {{serviceName}}
- Amount: {{amount}}
- Tax: {{taxAmount}}
- Document type: {{docType}}
- Issue date: {{issueDate}}

{{#if dictionaryContext}}
Previous pattern from dictionary:
{{dictionaryContext}}
{{/if}}

Generate up to 3 journal entry suggestions with confidence scores.
Consider:
1. Appropriate expense account (勘定科目)
2. Tax classification (課税区分)
3. Whether this might be a prepaid expense (前払費用)
4. Payment method implications

Return JSON:
{
  "suggestions": [
    {
      "entries": [
        {
          "entryNo": 1,
          "transactionDate": "YYYY-MM-DD",
          "debit": {
            "accountName": "string",
            "subAccountName": "string or null",
            "taxClass": "string",
            "amount": number
          },
          "credit": {
            "accountName": "string",
            "subAccountName": "string or null",
            "amount": number
          },
          "description": "string"
        }
      ],
      "confidence": 0.0-1.0,
      "reasoning": "string"
    }
  ]
}`,
    isActive: true,
    version: 1,
    createdBy: 'system',
    notes: 'Default prompt for generating journal entry suggestions'
  },
  {
    promptId: DEFAULT_PROMPT_IDS.VALIDATION,
    promptName: 'Default Validation Prompt',
    promptType: 'validation',
    promptText: `You are an expert Japanese accountant. Validate the following journal entry for accounting accuracy.

Entry to validate:
{{entryJson}}

Check for:
1. Debit and credit balance
2. Appropriate account usage
3. Tax classification correctness
4. Common accounting errors

Return JSON:
{
  "isValid": boolean,
  "errors": ["string"],
  "warnings": ["string"],
  "suggestions": ["string"]
}`,
    isActive: true,
    version: 1,
    createdBy: 'system',
    notes: 'Default prompt for validating journal entries'
  }
];

export class PromptConfigSheetManager {
  private spreadsheetId: string;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.sheet = this.getOrCreateSheet();
  }

  /**
   * Get or create the PromptConfigSheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    try {
      const spreadsheet = SpreadsheetApp.openById(this.spreadsheetId);
      let sheet = spreadsheet.getSheetByName(SHEET_NAME);

      if (!sheet) {
        sheet = spreadsheet.insertSheet(SHEET_NAME);
        this.initializeHeaders(sheet);
        this.insertDefaultPrompts(sheet);
        AppLogger.info(`Created new ${SHEET_NAME} sheet with default prompts`);
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
    const headers = PROMPT_CONFIG_COLUMNS.map(col => col);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  /**
   * Insert default prompts
   */
  private insertDefaultPrompts(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
    const now = new Date();

    for (const prompt of DEFAULT_PROMPTS) {
      const fullPrompt: PromptConfig = {
        ...prompt,
        createdAt: now
      };
      const row = this.configToRow(fullPrompt);
      sheet.appendRow(row);
    }
  }

  /**
   * Generate a new UUID for prompt configs
   */
  private generateUuid(): string {
    return Utilities.getUuid();
  }

  /**
   * Create a new prompt config
   */
  create(
    config: Omit<PromptConfig, 'promptId' | 'version' | 'createdAt'>
  ): PromptConfig {
    try {
      const now = new Date();
      const promptId = this.generateUuid();

      const fullConfig: PromptConfig = {
        ...config,
        promptId,
        version: 1,
        createdAt: now
      };

      const row = this.configToRow(fullConfig);
      this.sheet.appendRow(row);

      AppLogger.info(`Created prompt config: ${promptId}`);
      return fullConfig;
    } catch (error) {
      AppLogger.error('Error creating prompt config', error as Error);
      throw error;
    }
  }

  /**
   * Get a prompt config by ID
   */
  getById(promptId: string): PromptConfig | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === promptId) {
          return this.rowToConfig(data[i]);
        }
      }

      return null;
    } catch (error) {
      AppLogger.error('Error getting prompt config by ID', error as Error);
      return null;
    }
  }

  /**
   * Get active prompt by type
   */
  getActiveByType(promptType: PromptType): PromptConfig | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        const config = this.rowToConfig(data[i]);
        if (config.promptType === promptType && config.isActive) {
          return config;
        }
      }

      return null;
    } catch (error) {
      AppLogger.error('Error getting active prompt by type', error as Error);
      return null;
    }
  }

  /**
   * Get all prompt configs
   */
  getAll(): PromptConfig[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const configs: PromptConfig[] = [];

      for (let i = 1; i < data.length; i++) {
        configs.push(this.rowToConfig(data[i]));
      }

      return configs;
    } catch (error) {
      AppLogger.error('Error getting all prompt configs', error as Error);
      return [];
    }
  }

  /**
   * Get all prompts by type
   */
  getByType(promptType: PromptType): PromptConfig[] {
    try {
      const data = this.sheet.getDataRange().getValues();
      const configs: PromptConfig[] = [];

      for (let i = 1; i < data.length; i++) {
        const config = this.rowToConfig(data[i]);
        if (config.promptType === promptType) {
          configs.push(config);
        }
      }

      return configs;
    } catch (error) {
      AppLogger.error('Error getting prompts by type', error as Error);
      return [];
    }
  }

  /**
   * Update a prompt config (creates new version)
   */
  update(
    promptId: string,
    updates: Partial<Omit<PromptConfig, 'promptId' | 'createdAt'>>
  ): PromptConfig | null {
    try {
      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === promptId) {
          const existingConfig = this.rowToConfig(data[i]);
          const updatedConfig: PromptConfig = {
            ...existingConfig,
            ...updates,
            promptId: existingConfig.promptId,
            createdAt: existingConfig.createdAt,
            version: existingConfig.version + 1
          };

          const row = this.configToRow(updatedConfig);
          const range = this.sheet.getRange(i + 1, 1, 1, row.length);
          range.setValues([row]);

          AppLogger.info(`Updated prompt config: ${promptId} to version ${updatedConfig.version}`);
          return updatedConfig;
        }
      }

      AppLogger.warn(`Prompt config not found for update: ${promptId}`);
      return null;
    } catch (error) {
      AppLogger.error('Error updating prompt config', error as Error);
      return null;
    }
  }

  /**
   * Set active status for a prompt (deactivates others of same type if activating)
   */
  setActive(promptId: string, isActive: boolean): boolean {
    try {
      if (isActive) {
        const config = this.getById(promptId);
        if (!config) {
          return false;
        }

        const sameTypePrompts = this.getByType(config.promptType);
        for (const prompt of sameTypePrompts) {
          if (prompt.promptId !== promptId && prompt.isActive) {
            this.update(prompt.promptId, { isActive: false });
          }
        }
      }

      return this.update(promptId, { isActive }) !== null;
    } catch (error) {
      AppLogger.error('Error setting prompt active status', error as Error);
      return false;
    }
  }

  /**
   * Reset a prompt to its default version
   */
  resetToDefault(promptType: PromptType): boolean {
    try {
      const defaultPrompt = DEFAULT_PROMPTS.find(p => p.promptType === promptType);
      if (!defaultPrompt) {
        AppLogger.warn(`No default prompt found for type: ${promptType}`);
        return false;
      }

      const existingPrompt = this.getById(defaultPrompt.promptId);
      if (existingPrompt) {
        return this.update(defaultPrompt.promptId, {
          promptText: defaultPrompt.promptText,
          isActive: true
        }) !== null;
      } else {
        const now = new Date();
        const fullConfig: PromptConfig = {
          ...defaultPrompt,
          createdAt: now
        };
        const row = this.configToRow(fullConfig);
        this.sheet.appendRow(row);
        return true;
      }
    } catch (error) {
      AppLogger.error('Error resetting prompt to default', error as Error);
      return false;
    }
  }

  /**
   * Delete a prompt config (cannot delete default prompts)
   */
  delete(promptId: string): boolean {
    try {
      const isDefault = Object.values(DEFAULT_PROMPT_IDS).includes(promptId as any);
      if (isDefault) {
        AppLogger.warn(`Cannot delete default prompt: ${promptId}`);
        return false;
      }

      const data = this.sheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === promptId) {
          this.sheet.deleteRow(i + 1);
          AppLogger.info(`Deleted prompt config: ${promptId}`);
          return true;
        }
      }

      AppLogger.warn(`Prompt config not found for deletion: ${promptId}`);
      return false;
    } catch (error) {
      AppLogger.error('Error deleting prompt config', error as Error);
      return false;
    }
  }

  /**
   * Convert PromptConfig to row array
   */
  private configToRow(config: PromptConfig): (string | number | boolean | Date)[] {
    return [
      config.promptId,
      config.promptName,
      config.promptType,
      config.promptText,
      config.isActive,
      config.version,
      config.createdAt,
      config.createdBy,
      config.notes
    ];
  }

  /**
   * Convert row array to PromptConfig
   */
  private rowToConfig(row: unknown[]): PromptConfig {
    return {
      promptId: row[0] as string,
      promptName: row[1] as string,
      promptType: row[2] as PromptType,
      promptText: row[3] as string,
      isActive: Boolean(row[4]),
      version: Number(row[5]),
      createdAt: new Date(row[6] as string),
      createdBy: row[7] as string,
      notes: row[8] as string
    };
  }
}
