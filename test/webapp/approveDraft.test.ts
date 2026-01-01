/**
 * Tests for approveDraft behavior when dictionary registration is requested
 * but JournalGenerator is not available (Gemini API key not configured)
 *
 * Issue #50: Dictionary registration silently skipped when API key missing
 */

import { WebAppApi } from '../../src/webapp/WebAppApi';

// Mock GAS globals
const mockGetActiveUser = jest.fn().mockReturnValue({
  getEmail: () => 'test@example.com'
});

(globalThis as any).Session = {
  getActiveUser: mockGetActiveUser
};

// Mock DraftSheetManager
const mockDraftEntry = {
  draftId: 'test-draft-001',
  fileId: 'file-001',
  fileName: 'test.pdf',
  filePath: '/test/test.pdf',
  docType: 'invoice' as const,
  storageType: 'electronic' as const,
  vendorName: 'Test Vendor',
  serviceName: 'Test Service',
  amount: 1000,
  taxAmount: 100,
  issueDate: '2024-01-01',
  dueDate: '2024-01-31',
  eventMonth: '2024-01',
  paymentMonth: '2024-01',
  suggestedEntries: null,
  selectedEntry: [{ entryNo: 1, transactionDate: '2024-01-01', debit: { accountName: '通信費', amount: 1000 }, credit: { accountName: '未払金', amount: 1000 }, description: 'Test' }],
  dictionaryMatchId: '',
  status: 'approved' as const,
  reviewedBy: 'test@example.com',
  reviewedAt: new Date(),
  notes: '',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date()
};

jest.mock('../../src/modules/journal/DraftSheetManager', () => ({
  DraftSheetManager: jest.fn().mockImplementation(() => ({
    getById: jest.fn().mockReturnValue(mockDraftEntry),
    update: jest.fn().mockReturnValue(mockDraftEntry),
    updateStatus: jest.fn().mockReturnValue(mockDraftEntry)
  }))
}));

jest.mock('../../src/modules/journal/DictionarySheetManager', () => ({
  DictionarySheetManager: jest.fn().mockImplementation(() => ({
    getAll: jest.fn().mockReturnValue([])
  }))
}));

jest.mock('../../src/modules/journal/DraftHistorySheetManager', () => ({
  DraftHistorySheetManager: jest.fn().mockImplementation(() => ({
    getHistoryByDraftId: jest.fn().mockReturnValue([])
  }))
}));

jest.mock('../../src/modules/journal/DictionaryHistorySheetManager', () => ({
  DictionaryHistorySheetManager: jest.fn().mockImplementation(() => ({
    getHistoryByDictId: jest.fn().mockReturnValue([])
  }))
}));

jest.mock('../../src/modules/journal/PromptService', () => ({
  PromptService: jest.fn().mockImplementation(() => ({
    getAll: jest.fn().mockReturnValue([])
  }))
}));

describe('approveDraft', () => {
  describe('dictionary registration warning', () => {
    it('should return warning when registerToDict=true but Gemini API key not configured', () => {
      // Create WebAppApi without geminiApiKey (journalGenerator will be null)
      const api = new WebAppApi({
        spreadsheetId: 'test-spreadsheet-id'
        // No geminiApiKey provided
      });

      const result = api.approveDraft(
        'test-draft-001',
        [{ entryNo: 1, transactionDate: '2024-01-01', debit: { accountName: '通信費', amount: 1000 }, credit: { accountName: '未払金', amount: 1000 }, description: 'Test' }],
        true, // registerToDict = true
        'Test approval'
      );

      expect(result).not.toBeNull();
      expect(result?.draft).toBeDefined();
      expect(result?.warnings).toBeDefined();
      expect(result?.warnings).toHaveLength(1);
      expect(result?.warnings?.[0]).toContain('Dictionary registration was skipped');
      expect(result?.warnings?.[0]).toContain('Gemini API key not configured');
    });

    it('should not return warning when registerToDict=false', () => {
      const api = new WebAppApi({
        spreadsheetId: 'test-spreadsheet-id'
        // No geminiApiKey provided
      });

      const result = api.approveDraft(
        'test-draft-001',
        [{ entryNo: 1, transactionDate: '2024-01-01', debit: { accountName: '通信費', amount: 1000 }, credit: { accountName: '未払金', amount: 1000 }, description: 'Test' }],
        false, // registerToDict = false
        'Test approval'
      );

      expect(result).not.toBeNull();
      expect(result?.draft).toBeDefined();
      expect(result?.warnings).toBeUndefined();
    });

    it('should still approve draft successfully even when warning is returned', () => {
      const api = new WebAppApi({
        spreadsheetId: 'test-spreadsheet-id'
      });

      const result = api.approveDraft(
        'test-draft-001',
        [{ entryNo: 1, transactionDate: '2024-01-01', debit: { accountName: '通信費', amount: 1000 }, credit: { accountName: '未払金', amount: 1000 }, description: 'Test' }],
        true,
        'Test approval'
      );

      // Primary action (approval) should succeed
      expect(result).not.toBeNull();
      expect(result?.draft.draftId).toBe('test-draft-001');
      expect(result?.draft.status).toBe('approved');
      // Warning should be present but not prevent approval
      expect(result?.warnings).toBeDefined();
    });
  });
});
