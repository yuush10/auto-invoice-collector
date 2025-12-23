/**
 * Cookie Expiration Tracking Service
 * Monitors vendor cookie expiration and sends warnings before they expire
 */

import { Config, VENDOR_CONFIGS } from '../../config';
import { CookieMetadata, CookieStatus } from '../../types/vendor';
import { AppLogger } from '../../utils/logger';

const COOKIE_SHEET_NAME = 'CookieMetadata';
const DEFAULT_WARN_DAYS = 7;

/**
 * Column indices for cookie metadata sheet (0-indexed)
 */
enum CookieSheetColumn {
  VendorKey = 0,
  UpdatedAt = 1,
  ExpiresAt = 2,
  WarnDays = 3,
  WarningSent = 4,
  LastVerified = 5,
}

/**
 * Cookie Expiration Tracker
 * Uses Google Sheets to persist cookie metadata
 */
export class CookieExpirationTracker {
  private spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor() {
    const sheetId = Config.getLogSheetId();
    this.spreadsheet = SpreadsheetApp.openById(sheetId);
    this.sheet = this.getOrCreateSheet();
  }

  /**
   * Get or create the cookie metadata sheet
   */
  private getOrCreateSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    let sheet = this.spreadsheet.getSheetByName(COOKIE_SHEET_NAME);
    if (!sheet) {
      sheet = this.spreadsheet.insertSheet(COOKIE_SHEET_NAME);
      // Add headers
      sheet.appendRow([
        'VendorKey',
        'UpdatedAt',
        'ExpiresAt',
        'WarnDays',
        'WarningSent',
        'LastVerified',
      ]);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
      AppLogger.info('[CookieTracker] Created CookieMetadata sheet');
    }
    return sheet;
  }

  /**
   * Get all cookie metadata records
   */
  getAllCookieMetadata(): CookieMetadata[] {
    const data = this.sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return [];
    }

    return data.slice(1).map(row => ({
      vendorKey: row[CookieSheetColumn.VendorKey] as string,
      updatedAt: new Date(row[CookieSheetColumn.UpdatedAt]),
      expiresAt: row[CookieSheetColumn.ExpiresAt]
        ? new Date(row[CookieSheetColumn.ExpiresAt])
        : undefined,
      warnDays: (row[CookieSheetColumn.WarnDays] as number) || DEFAULT_WARN_DAYS,
      warningSent: row[CookieSheetColumn.WarningSent] === true,
      lastVerified: row[CookieSheetColumn.LastVerified]
        ? new Date(row[CookieSheetColumn.LastVerified])
        : undefined,
    }));
  }

  /**
   * Get cookie metadata for a specific vendor
   */
  getCookieMetadata(vendorKey: string): CookieMetadata | null {
    const all = this.getAllCookieMetadata();
    return all.find(m => m.vendorKey === vendorKey) || null;
  }

  /**
   * Update or create cookie metadata for a vendor
   */
  updateCookieMetadata(metadata: Partial<CookieMetadata> & { vendorKey: string }): void {
    const existingRow = this.findVendorRow(metadata.vendorKey);
    const now = new Date();

    const rowData = [
      metadata.vendorKey,
      metadata.updatedAt || now,
      metadata.expiresAt || '',
      metadata.warnDays || DEFAULT_WARN_DAYS,
      metadata.warningSent || false,
      metadata.lastVerified || '',
    ];

    if (existingRow > 0) {
      this.sheet.getRange(existingRow, 1, 1, 6).setValues([rowData]);
      AppLogger.info(`[CookieTracker] Updated metadata for ${metadata.vendorKey}`);
    } else {
      this.sheet.appendRow(rowData);
      AppLogger.info(`[CookieTracker] Created metadata for ${metadata.vendorKey}`);
    }
  }

  /**
   * Record successful authentication for a vendor
   */
  recordSuccessfulAuth(vendorKey: string): void {
    const existing = this.getCookieMetadata(vendorKey);
    this.updateCookieMetadata({
      vendorKey,
      updatedAt: existing?.updatedAt || new Date(),
      expiresAt: existing?.expiresAt,
      warnDays: existing?.warnDays || DEFAULT_WARN_DAYS,
      warningSent: false, // Reset warning sent on successful auth
      lastVerified: new Date(),
    });
  }

  /**
   * Record cookie update with optional expiration date
   */
  recordCookieUpdate(vendorKey: string, expiresAt?: Date): void {
    this.updateCookieMetadata({
      vendorKey,
      updatedAt: new Date(),
      expiresAt,
      warnDays: DEFAULT_WARN_DAYS,
      warningSent: false,
      lastVerified: new Date(),
    });
  }

  /**
   * Mark warning as sent for a vendor
   */
  markWarningSent(vendorKey: string): void {
    const existing = this.getCookieMetadata(vendorKey);
    if (existing) {
      this.updateCookieMetadata({
        ...existing,
        warningSent: true,
      });
    }
  }

  /**
   * Check cookie status for all vendors
   */
  checkAllCookieStatus(): CookieStatus[] {
    const results: CookieStatus[] = [];
    const allMetadata = this.getAllCookieMetadata();
    const now = new Date();

    for (const config of VENDOR_CONFIGS) {
      if (!config.loginRequired) {
        continue;
      }

      const metadata = allMetadata.find(m => m.vendorKey === config.vendorKey);
      const status = this.calculateCookieStatus(config.vendorKey, metadata, now);
      results.push(status);
    }

    return results;
  }

  /**
   * Get vendors that need cookie expiration warning
   */
  getVendorsNeedingWarning(): CookieStatus[] {
    return this.checkAllCookieStatus().filter(
      status => status.shouldWarn && !this.isWarningSent(status.vendorKey)
    );
  }

  /**
   * Calculate cookie status for a vendor
   */
  private calculateCookieStatus(
    vendorKey: string,
    metadata: CookieMetadata | undefined,
    now: Date
  ): CookieStatus {
    if (!metadata) {
      return {
        vendorKey,
        isValid: false,
        shouldWarn: true,
        statusMessage: 'Cookie情報が登録されていません',
      };
    }

    // If no expiration date, check based on last verified date
    if (!metadata.expiresAt) {
      const daysSinceVerified = metadata.lastVerified
        ? Math.floor((now.getTime() - metadata.lastVerified.getTime()) / (1000 * 60 * 60 * 24))
        : Infinity;

      // If not verified in 30 days, recommend refresh
      if (daysSinceVerified > 30) {
        return {
          vendorKey,
          isValid: true,
          shouldWarn: true,
          statusMessage: `${daysSinceVerified}日間認証確認されていません。Cookieの更新を推奨します`,
        };
      }

      return {
        vendorKey,
        isValid: true,
        daysUntilExpiration: undefined,
        shouldWarn: false,
        statusMessage: '有効期限不明（最終確認から問題なし）',
      };
    }

    // Calculate days until expiration
    const daysUntilExpiration = Math.floor(
      (metadata.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiration < 0) {
      return {
        vendorKey,
        isValid: false,
        daysUntilExpiration,
        shouldWarn: true,
        statusMessage: `Cookieは${Math.abs(daysUntilExpiration)}日前に期限切れになりました`,
      };
    }

    const shouldWarn = daysUntilExpiration <= metadata.warnDays;

    return {
      vendorKey,
      isValid: true,
      daysUntilExpiration,
      shouldWarn,
      statusMessage: shouldWarn
        ? `Cookieは${daysUntilExpiration}日後に期限切れになります`
        : `Cookie有効（残り${daysUntilExpiration}日）`,
    };
  }

  /**
   * Check if warning was already sent
   */
  private isWarningSent(vendorKey: string): boolean {
    const metadata = this.getCookieMetadata(vendorKey);
    return metadata?.warningSent || false;
  }

  /**
   * Find the row number for a vendor (1-indexed, 0 if not found)
   */
  private findVendorRow(vendorKey: string): number {
    const data = this.sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][CookieSheetColumn.VendorKey] === vendorKey) {
        return i + 1; // Convert to 1-indexed
      }
    }
    return 0;
  }
}

// Export singleton instance
let trackerInstance: CookieExpirationTracker | null = null;

export function getCookieExpirationTracker(): CookieExpirationTracker {
  if (!trackerInstance) {
    trackerInstance = new CookieExpirationTracker();
  }
  return trackerInstance;
}
