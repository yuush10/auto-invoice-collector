/**
 * Date utility functions
 */

/**
 * Format date to YYYY-MM
 */
export function formatYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse YYYY-MM string to Date object
 */
export function parseYearMonth(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/**
 * Get the most frequent year-month from a list of dates
 */
export function getMostFrequentYearMonth(dates: string[]): string {
  if (dates.length === 0) {
    throw new Error('No dates provided');
  }

  const yearMonthCounts = new Map<string, number>();

  dates.forEach(dateStr => {
    const date = new Date(dateStr);
    const yearMonth = formatYearMonth(date);
    yearMonthCounts.set(yearMonth, (yearMonthCounts.get(yearMonth) || 0) + 1);
  });

  let maxCount = 0;
  let mostFrequent = '';

  yearMonthCounts.forEach((count, yearMonth) => {
    if (count > maxCount) {
      maxCount = count;
      mostFrequent = yearMonth;
    }
  });

  return mostFrequent;
}
