/**
 * Type definitions for audit trail and version history (電子帳簿保存法 compliance)
 */

/**
 * Action types for history entries
 */
export type HistoryAction = 'created' | 'updated' | 'status_changed' | 'deleted';

/**
 * Represents a single field change in history
 */
export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Base interface for all history entries
 */
export interface BaseHistoryEntry {
  historyId: string;
  version: number;
  action: HistoryAction;
  changedBy: string;
  changedAt: Date;
  fieldChanges: FieldChange[];
  reason?: string;
}

/**
 * Draft history entry for audit trail
 */
export interface DraftHistoryEntry extends BaseHistoryEntry {
  draftId: string;
  snapshot: Record<string, unknown>;
}

/**
 * Dictionary history entry for audit trail
 */
export interface DictionaryHistoryEntry extends BaseHistoryEntry {
  dictId: string;
  snapshot: Record<string, unknown>;
}

/**
 * Column definitions for DraftHistorySheet
 */
export const DRAFT_HISTORY_COLUMNS = [
  'history_id',
  'draft_id',
  'version',
  'action',
  'changed_by',
  'changed_at',
  'field_changes',
  'snapshot',
  'reason'
] as const;

/**
 * Column definitions for DictionaryHistorySheet
 */
export const DICTIONARY_HISTORY_COLUMNS = [
  'history_id',
  'dict_id',
  'version',
  'action',
  'changed_by',
  'changed_at',
  'field_changes',
  'snapshot',
  'reason'
] as const;

export type DraftHistoryColumn = typeof DRAFT_HISTORY_COLUMNS[number];
export type DictionaryHistoryColumn = typeof DICTIONARY_HISTORY_COLUMNS[number];

/**
 * Utility function to calculate field changes between two objects
 */
export function calculateFieldChanges(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  excludeFields: string[] = ['updatedAt', 'version']
): FieldChange[] {
  const changes: FieldChange[] = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    if (excludeFields.includes(key)) {
      continue;
    }

    const oldValue = oldObj[key];
    const newValue = newObj[key];

    // Compare JSON stringified values for objects/arrays
    const oldStr = JSON.stringify(oldValue);
    const newStr = JSON.stringify(newValue);

    if (oldStr !== newStr) {
      changes.push({
        field: key,
        oldValue,
        newValue
      });
    }
  }

  return changes;
}
