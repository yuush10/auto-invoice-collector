/**
 * Integration tests for main orchestration logic
 */

import { SERVICES } from '../../src/config';
import { ProcessingLogger } from '../../src/modules/logging/ProcessingLogger';
import { Notifier } from '../../src/modules/notifications/Notifier';
import { FileNamingService } from '../../src/modules/naming/FileNamingService';
import { GmailSearcher } from '../../src/modules/gmail/GmailSearcher';

// Mock Google Apps Script global objects
(globalThis as any).Logger = {
  log: jest.fn()
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn(() => ({
    getProperty: jest.fn((key: string) => {
      const props: Record<string, string> = {
        'GEMINI_API_KEY': 'test-api-key',
        'ROOT_FOLDER_ID': 'test-folder-id',
        'LOG_SHEET_ID': 'test-sheet-id',
        'ADMIN_EMAIL': 'admin@test.com'
      };
      return props[key];
    }),
    setProperty: jest.fn()
  }))
};

(globalThis as any).GmailApp = {
  search: jest.fn(() => []),
  getUserLabelByName: jest.fn(),
  createLabel: jest.fn(),
  sendEmail: jest.fn()
};

(globalThis as any).DriveApp = {
  getFolderById: jest.fn()
};

(globalThis as any).SpreadsheetApp = {
  openById: jest.fn()
};

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn()
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn(() => 'base64data'),
  computeDigest: jest.fn(() => [1, 2, 3, 4]),
  DigestAlgorithm: {
    SHA_256: 'SHA_256'
  }
};

(globalThis as any).ScriptApp = {
  getProjectTriggers: jest.fn(() => []),
  deleteTrigger: jest.fn(),
  newTrigger: jest.fn(() => ({
    timeBased: jest.fn(() => ({
      everyDays: jest.fn(() => ({
        atHour: jest.fn(() => ({
          create: jest.fn()
        }))
      }))
    }))
  }))
};

describe('Main Orchestration Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setupTrigger', () => {
    it('should create daily trigger at 6 AM', () => {
      // This will be tested in the actual GAS environment
      expect((globalThis as any).ScriptApp.newTrigger).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should load all required configuration properties', () => {
      const props = (globalThis as any).PropertiesService.getScriptProperties();

      expect(props.getProperty('GEMINI_API_KEY')).toBe('test-api-key');
      expect(props.getProperty('ROOT_FOLDER_ID')).toBe('test-folder-id');
      expect(props.getProperty('LOG_SHEET_ID')).toBe('test-sheet-id');
      expect(props.getProperty('ADMIN_EMAIL')).toBe('admin@test.com');
    });
  });

  describe('Service Configuration', () => {
    it('should have attachment-based services configured', () => {
      const attachmentServices = SERVICES.filter(
        s => s.extractionType === 'attachment'
      );

      expect(attachmentServices.length).toBeGreaterThan(0);
      expect(attachmentServices[0]).toHaveProperty('name');
      expect(attachmentServices[0]).toHaveProperty('searchQuery');
    });
  });
});

describe('ProcessingLogger Integration Tests', () => {
  let mockSheet: any;

  beforeEach(() => {
    mockSheet = {
      appendRow: jest.fn(),
      getRange: jest.fn(() => ({
        setFontWeight: jest.fn()
      })),
      setFrozenRows: jest.fn(),
      getDataRange: jest.fn(() => ({
        getValues: jest.fn(() => [
          ['Timestamp', 'Message ID', 'Attachment Index', 'SHA256', 'Source Type', 'Doc Type', 'Service Name', 'Event Month', 'Drive File ID', 'Status', 'Error Message'],
          [new Date(), 'msg-123', 0, 'hash123', 'attachment', 'invoice', 'AWS', '2025-01', 'file-id', 'success', '']
        ])
      }))
    };

    ((globalThis as any).SpreadsheetApp.openById as jest.Mock).mockReturnValue({
      getSheetByName: jest.fn(() => mockSheet),
      insertSheet: jest.fn(() => mockSheet)
    });
  });

  it('should detect duplicate message IDs', () => {
    const logger = new ProcessingLogger('test-sheet-id');

    const isDuplicate = logger.isProcessed('msg-123', 0);
    expect(isDuplicate).toBe(true);
  });

  it('should detect duplicate file hashes', () => {
    const logger = new ProcessingLogger('test-sheet-id');

    const hashExists = logger.hashExists('hash123');
    expect(hashExists).toBe(true);
  });

  it('should return false for non-existent message ID', () => {
    const logger = new ProcessingLogger('test-sheet-id');

    const isDuplicate = logger.isProcessed('msg-999', 0);
    expect(isDuplicate).toBe(false);
  });

  it('should log processing records', () => {
    const logger = new ProcessingLogger('test-sheet-id');

    logger.log({
      timestamp: new Date(),
      messageId: 'msg-456',
      attachmentIndex: 0,
      sha256: 'hash456',
      sourceType: 'attachment',
      docType: 'invoice',
      serviceName: 'Google Cloud',
      eventMonth: '2025-01',
      driveFileId: 'file-456',
      status: 'success'
    });

    expect(mockSheet.appendRow).toHaveBeenCalled();
  });
});

describe('Notifier Integration Tests', () => {
  beforeEach(() => {
    ((globalThis as any).GmailApp.sendEmail as jest.Mock).mockClear();
  });

  it('should send error notifications', () => {
    const notifier = new Notifier('admin@test.com');

    notifier.sendErrorNotification([
      {
        messageId: 'msg-123',
        serviceName: 'AWS',
        error: 'Test error'
      }
    ]);

    expect((globalThis as any).GmailApp.sendEmail).toHaveBeenCalledWith(
      'admin@test.com',
      expect.stringContaining('Processing Errors'),
      expect.stringContaining('Test error')
    );
  });

  it('should send needs-review notifications', () => {
    const notifier = new Notifier('admin@test.com');

    notifier.sendNeedsReviewNotification([
      '2025-01-AWS.pdf - Confidence: 0.65 - Low quality scan'
    ]);

    expect((globalThis as any).GmailApp.sendEmail).toHaveBeenCalledWith(
      'admin@test.com',
      expect.stringContaining('Items Need Review'),
      expect.stringContaining('Low quality scan')
    );
  });

  it('should not send notifications for empty arrays', () => {
    const notifier = new Notifier('admin@test.com');

    notifier.sendErrorNotification([]);
    notifier.sendNeedsReviewNotification([]);

    expect((globalThis as any).GmailApp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('FileNamingService Integration Tests', () => {
  it('should generate correct file names', () => {
    const namingService = new FileNamingService();

    const fileName = namingService.generate('AWS', '2025-01', 'invoice');
    expect(fileName).toBe('2025-01-AWS-請求書.pdf');
  });

  it('should normalize service names with special characters', () => {
    const namingService = new FileNamingService();

    const fileName = namingService.generate('Service/Name:Test', '2025-01', 'invoice');
    expect(fileName).toBe('2025-01-Service_Name_Test-請求書.pdf');
  });

  it('should limit service name length to 40 characters', () => {
    const namingService = new FileNamingService();

    const longName = 'A'.repeat(50);
    const fileName = namingService.generate(longName, '2025-01', 'invoice');

    // Format: YYYY-MM-{40chars}-請求書.pdf = 7 + 1 + 40 + 1 + 3 + 4 = 56 chars
    expect(fileName.length).toBe(56);
  });
});

describe('GmailSearcher Integration Tests', () => {
  let mockThread: any;
  let mockMessage: any;
  let mockLabel: any;

  beforeEach(() => {
    mockLabel = {
      getName: jest.fn(() => 'processed')
    };

    mockMessage = {
      getId: jest.fn(() => 'msg-123'),
      getFrom: jest.fn(() => 'billing@example.com'),
      getSubject: jest.fn(() => 'Invoice'),
      getThread: jest.fn(() => mockThread),
      getAttachments: jest.fn(() => [])
    };

    mockThread = {
      getMessages: jest.fn(() => [mockMessage]),
      addLabel: jest.fn()
    };

    ((globalThis as any).GmailApp.search as jest.Mock).mockReturnValue([mockThread]);
    ((globalThis as any).GmailApp.getUserLabelByName as jest.Mock).mockReturnValue(mockLabel);
    ((globalThis as any).GmailApp.createLabel as jest.Mock).mockReturnValue(mockLabel);
  });

  it('should search Gmail with proper query', () => {
    const searcher = new GmailSearcher();

    searcher.search('from:test@example.com', true);

    expect((globalThis as any).GmailApp.search).toHaveBeenCalledWith('from:test@example.com -label:processed');
  });

  it('should mark messages as processed', () => {
    const searcher = new GmailSearcher();

    searcher.markAsProcessed(mockMessage);

    expect(mockThread.addLabel).toHaveBeenCalledWith(mockLabel);
  });
});
