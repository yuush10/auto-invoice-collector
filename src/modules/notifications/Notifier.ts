/**
 * Email notification service
 */

import { ProcessingError, ProcessingResult } from '../../types';
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
}
