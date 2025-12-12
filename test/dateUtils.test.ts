import {
  formatYearMonth,
  formatDate,
  parseYearMonth,
  getMostFrequentYearMonth
} from '../src/utils/dateUtils';

describe('dateUtils', () => {
  describe('formatYearMonth', () => {
    it('should format date to YYYY-MM', () => {
      const date = new Date(2025, 0, 15); // January 15, 2025
      expect(formatYearMonth(date)).toBe('2025-01');
    });

    it('should pad single digit months', () => {
      const date = new Date(2025, 8, 5); // September 5, 2025
      expect(formatYearMonth(date)).toBe('2025-09');
    });
  });

  describe('formatDate', () => {
    it('should format date to YYYY-MM-DD', () => {
      const date = new Date(2025, 0, 15);
      expect(formatDate(date)).toBe('2025-01-15');
    });

    it('should pad single digit days and months', () => {
      const date = new Date(2025, 0, 5);
      expect(formatDate(date)).toBe('2025-01-05');
    });
  });

  describe('parseYearMonth', () => {
    it('should parse YYYY-MM to Date', () => {
      const date = parseYearMonth('2025-01');
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(1);
    });
  });

  describe('getMostFrequentYearMonth', () => {
    it('should return most frequent year-month', () => {
      const dates = [
        '2025-01-10',
        '2025-01-15',
        '2025-01-20',
        '2025-02-05',
        '2025-02-10'
      ];
      expect(getMostFrequentYearMonth(dates)).toBe('2025-01');
    });

    it('should throw error for empty array', () => {
      expect(() => getMostFrequentYearMonth([])).toThrow('No dates provided');
    });
  });
});
