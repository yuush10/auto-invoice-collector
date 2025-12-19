/**
 * Email notification service
 */

import { ProcessingError, ProcessingResult, VendorAuthNotification } from '../../types';
import { AppLogger } from '../../utils/logger';

export class Notifier {
  private adminEmail: string;

  constructor(adminEmail: string) {
    this.adminEmail = adminEmail;
  }

  /**
   * Send error notification email
   */
  sendErrorNotification(errors: ProcessingError[]): void {
    try {
      if (errors.length === 0) {
        return;
      }

      const subject = `[Auto Invoice Collector] Processing Errors (${errors.length})`;
      const body = this.formatErrorReport(errors);

      GmailApp.sendEmail(this.adminEmail, subject, body);
      AppLogger.info(`Sent error notification to ${this.adminEmail}`);
    } catch (error) {
      AppLogger.error('Error sending error notification', error as Error);
    }
  }

  /**
   * Send needs-review notification
   */
  sendNeedsReviewNotification(needsReview: string[]): void {
    try {
      if (needsReview.length === 0) {
        return;
      }

      const subject = `[Auto Invoice Collector] Items Need Review (${needsReview.length})`;
      const body = this.formatNeedsReviewReport(needsReview);

      GmailApp.sendEmail(this.adminEmail, subject, body);
      AppLogger.info(`Sent needs-review notification to ${this.adminEmail}`);
    } catch (error) {
      AppLogger.error('Error sending needs-review notification', error as Error);
    }
  }

  /**
   * Send processing summary
   */
  sendProcessingSummary(result: ProcessingResult): void {
    try {
      const subject = `[Auto Invoice Collector] Daily Processing Summary`;
      const body = this.formatSummaryReport(result);

      GmailApp.sendEmail(this.adminEmail, subject, body);
      AppLogger.info(`Sent processing summary to ${this.adminEmail}`);
    } catch (error) {
      AppLogger.error('Error sending processing summary', error as Error);
    }
  }

  /**
   * Send vendor auth failure notification with screenshots
   */
  sendVendorAuthFailureNotification(notification: VendorAuthNotification): void {
    try {
      const subject = `[Auto Invoice Collector] 認証エラー: ${notification.vendorName}`;
      const htmlBody = this.formatVendorAuthFailureReport(notification);

      // Build attachments if screenshots available
      const attachments: GoogleAppsScript.Base.BlobSource[] = [];
      if (notification.screenshots && notification.screenshots.length > 0) {
        notification.screenshots.forEach((base64, index) => {
          try {
            const decoded = Utilities.base64Decode(base64);
            const blob = Utilities.newBlob(
              decoded,
              'image/png',
              `screenshot-${index + 1}.png`
            );
            attachments.push(blob);
          } catch (err) {
            AppLogger.warn(`Failed to decode screenshot ${index + 1}: ${err}`);
          }
        });
      }

      // Use GmailApp instead of MailApp (uses existing gmail.send scope)
      GmailApp.sendEmail(this.adminEmail, subject, '', {
        htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      AppLogger.info(
        `Sent vendor auth failure notification for ${notification.vendorKey} to ${this.adminEmail}`
      );
    } catch (error) {
      AppLogger.error('Error sending vendor auth failure notification', error as Error);
    }
  }

  /**
   * Send cookie expiration warning
   */
  sendCookieExpirationWarning(
    vendorKey: string,
    vendorName: string,
    daysUntilExpiration: number
  ): void {
    try {
      const subject = `[Auto Invoice Collector] Cookie期限切れ警告: ${vendorName}`;
      const body = this.formatCookieExpirationWarning(vendorName, daysUntilExpiration);

      GmailApp.sendEmail(this.adminEmail, subject, body);
      AppLogger.info(
        `Sent cookie expiration warning for ${vendorKey} to ${this.adminEmail}`
      );
    } catch (error) {
      AppLogger.error('Error sending cookie expiration warning', error as Error);
    }
  }

  /**
   * Format error report
   */
  private formatErrorReport(errors: ProcessingError[]): string {
    let report = 'The following errors occurred during invoice processing:\n\n';

    errors.forEach((err, index) => {
      report += `${index + 1}. Service: ${err.serviceName}\n`;
      report += `   Message ID: ${err.messageId}\n`;
      report += `   Error: ${err.error}\n\n`;
    });

    report += '\nPlease check the logs for more details.';
    return report;
  }

  /**
   * Format needs-review report
   */
  private formatNeedsReviewReport(needsReview: string[]): string {
    let report = 'The following invoices need manual review due to low confidence:\n\n';

    needsReview.forEach((item, index) => {
      report += `${index + 1}. ${item}\n`;
    });

    report += '\nPlease check the Google Drive folder and verify the extracted information.';
    return report;
  }

  /**
   * Format summary report
   */
  private formatSummaryReport(result: ProcessingResult): string {
    let report = 'Auto Invoice Collector - Daily Processing Summary\n\n';
    report += `Total Processed: ${result.processed}\n`;
    report += `Errors: ${result.errors.length}\n`;
    report += `Needs Review: ${result.needsReview.length}\n\n`;

    if (result.errors.length > 0) {
      report += 'Errors:\n';
      result.errors.forEach((err, index) => {
        report += `  ${index + 1}. ${err.serviceName} - ${err.error}\n`;
      });
      report += '\n';
    }

    if (result.needsReview.length > 0) {
      report += 'Needs Review:\n';
      result.needsReview.forEach((item, index) => {
        report += `  ${index + 1}. ${item}\n`;
      });
    }

    return report;
  }

  /**
   * Format vendor auth failure report as HTML
   */
  private formatVendorAuthFailureReport(notification: VendorAuthNotification): string {
    const failureTypeLabels: Record<string, string> = {
      session_expired: 'セッション期限切れ',
      login_required: 'ログイン必要',
      captcha_required: 'CAPTCHA認証必要',
      mfa_required: '多要素認証(MFA)必要',
      cookie_expired: 'Cookie期限切れ',
      credentials_invalid: '認証情報無効',
      account_locked: 'アカウントロック',
      unknown: '不明なエラー',
    };

    const failureLabel = failureTypeLabels[notification.failureType] || notification.failureType;
    const timestamp = notification.failedAt.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Hiragino Sans', 'Meiryo', sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc3545; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border: 1px solid #ddd; border-top: none; }
    .section { margin-bottom: 20px; }
    .section h3 { color: #495057; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
    .info-row { margin: 8px 0; }
    .label { font-weight: bold; color: #666; }
    .instructions { background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 15px; }
    .instructions ul { margin: 10px 0; padding-left: 20px; list-style-type: none; }
    .instructions li { margin: 5px 0; }
    .url { word-break: break-all; font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
    .footer { margin-top: 20px; font-size: 12px; color: #666; }
    .screenshot-note { background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 5px; padding: 10px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0;">ベンダー認証エラー</h2>
    </div>
    <div class="content">
      <div class="section">
        <h3>エラー概要</h3>
        <div class="info-row"><span class="label">ベンダー:</span> ${notification.vendorName}</div>
        <div class="info-row"><span class="label">エラー種別:</span> ${failureLabel}</div>
        <div class="info-row"><span class="label">発生日時:</span> ${timestamp}</div>
        ${notification.currentUrl ? `<div class="info-row"><span class="label">URL:</span> <span class="url">${notification.currentUrl}</span></div>` : ''}
        <div class="info-row"><span class="label">詳細:</span> ${notification.errorMessage}</div>
      </div>

      <div class="section">
        <h3>復旧手順</h3>
        <div class="instructions">
          <ul>
            ${notification.recoveryInstructions.map(inst => `<li>${inst}</li>`).join('\n            ')}
          </ul>
        </div>
      </div>
`;

    if (notification.screenshots && notification.screenshots.length > 0) {
      html += `
      <div class="section">
        <div class="screenshot-note">
          <strong>スクリーンショット添付:</strong> ${notification.screenshots.length}枚のスクリーンショットがこのメールに添付されています。エラー発生時の画面状態を確認してください。
        </div>
      </div>
`;
    }

    html += `
      <div class="footer">
        <p>このメールは Auto Invoice Collector から自動送信されています。</p>
        <p>問題が解決したら、次回の自動実行で正常に処理されます。</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

    return html;
  }

  /**
   * Format cookie expiration warning
   */
  private formatCookieExpirationWarning(
    vendorName: string,
    daysUntilExpiration: number
  ): string {
    let report = `[警告] Cookie期限切れ警告\n\n`;
    report += `${vendorName}のCookieが${daysUntilExpiration}日後に期限切れになります。\n\n`;
    report += `以下の手順でCookieを更新してください:\n\n`;
    report += `1. ブラウザで${vendorName}のサイトにログインしてください\n`;
    report += `2. Cookie Export拡張機能でCookieをエクスポート\n`;
    report += `3. Secret ManagerのCookieを更新してください\n\n`;
    report += `期限切れになると自動請求書収集が失敗します。\n`;
    report += `お早めに更新をお願いします。`;
    return report;
  }
}
