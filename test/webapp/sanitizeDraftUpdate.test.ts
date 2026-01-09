import { sanitizeDraftUpdate } from '../../src/webapp/WebAppApi';

describe('sanitizeDraftUpdate', () => {
  describe('valid fields', () => {
    it('should preserve all allowed fields', () => {
      const input = {
        vendorName: 'Test Vendor',
        serviceName: 'Test Service',
        amount: 1000,
        taxAmount: 100,
        issueDate: '2024-01-15',
        dueDate: '2024-02-15',
        eventMonth: '2024-01',
        paymentMonth: '2024-02',
        selectedEntry: [{ debit: 'Test', credit: 'Test', amount: 1000 }],
        notes: 'Test notes'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual(input);
    });

    it('should preserve partial valid fields', () => {
      const input = {
        vendorName: 'Test Vendor',
        amount: 1000
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({
        vendorName: 'Test Vendor',
        amount: 1000
      });
    });
  });

  describe('protected fields (security vulnerability fix)', () => {
    it('should strip status field', () => {
      const input = {
        vendorName: 'Test Vendor',
        status: 'approved'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('status');
    });

    it('should strip reviewedBy field', () => {
      const input = {
        vendorName: 'Test Vendor',
        reviewedBy: 'attacker@example.com'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('reviewedBy');
    });

    it('should strip reviewedAt field', () => {
      const input = {
        vendorName: 'Test Vendor',
        reviewedAt: '2024-01-01T00:00:00Z'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('reviewedAt');
    });

    it('should strip draftId field', () => {
      const input = {
        vendorName: 'Test Vendor',
        draftId: 'malicious-id'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('draftId');
    });

    it('should strip version field', () => {
      const input = {
        vendorName: 'Test Vendor',
        version: 999
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('version');
    });

    it('should strip createdAt field', () => {
      const input = {
        vendorName: 'Test Vendor',
        createdAt: '2020-01-01T00:00:00Z'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('createdAt');
    });

    it('should strip updatedAt field', () => {
      const input = {
        vendorName: 'Test Vendor',
        updatedAt: '2020-01-01T00:00:00Z'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Test Vendor' });
      expect(result).not.toHaveProperty('updatedAt');
    });

    it('should strip all protected fields from malicious payload', () => {
      const input = {
        vendorName: 'Legitimate Update',
        draftId: 'completely-different-id',
        version: 999,
        status: 'approved',
        reviewedBy: 'attacker@example.com',
        reviewedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        fileId: 'malicious-file-id',
        fileName: 'malicious-file-name'
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toEqual({ vendorName: 'Legitimate Update' });
      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should return empty object for null input', () => {
      const result = sanitizeDraftUpdate(null);
      expect(result).toEqual({});
    });

    it('should return empty object for undefined input', () => {
      const result = sanitizeDraftUpdate(undefined);
      expect(result).toEqual({});
    });

    it('should return empty object for string input', () => {
      const result = sanitizeDraftUpdate('invalid');
      expect(result).toEqual({});
    });

    it('should return empty object for number input', () => {
      const result = sanitizeDraftUpdate(123);
      expect(result).toEqual({});
    });

    it('should return empty object for array input', () => {
      const result = sanitizeDraftUpdate([1, 2, 3]);
      expect(result).toEqual({});
    });

    it('should return empty object for empty object input', () => {
      const result = sanitizeDraftUpdate({});
      expect(result).toEqual({});
    });

    it('should handle undefined field values correctly', () => {
      const input = {
        vendorName: 'Test Vendor',
        serviceName: undefined
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toHaveProperty('vendorName', 'Test Vendor');
      expect(result).toHaveProperty('serviceName', undefined);
    });

    it('should handle null field values correctly', () => {
      const input = {
        vendorName: 'Test Vendor',
        serviceName: null
      };

      const result = sanitizeDraftUpdate(input);

      expect(result).toHaveProperty('vendorName', 'Test Vendor');
      expect(result).toHaveProperty('serviceName', null);
    });
  });
});
