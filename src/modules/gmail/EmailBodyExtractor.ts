import { AppLogger } from '../../utils/logger';

/**
 * Extract and clean HTML body from Gmail messages
 */
export class EmailBodyExtractor {
  /**
   * Extract HTML body from a Gmail message
   * @param message Gmail message
   * @returns HTML content or null if not found
   */
  static extractHtmlBody(message: GoogleAppsScript.Gmail.GmailMessage): string | null {
    try {
      // Try to get HTML body
      let htmlBody = message.getBody();

      if (!htmlBody || htmlBody.trim().length === 0) {
        AppLogger.warn('No HTML body found in message');
        return null;
      }

      // Clean and normalize HTML
      htmlBody = this.cleanHtml(htmlBody);

      AppLogger.debug(`Extracted HTML body (${htmlBody.length} chars)`);
      return htmlBody;
    } catch (error) {
      AppLogger.error('Error extracting HTML body', error as Error);
      return null;
    }
  }

  /**
   * Clean and normalize HTML content
   * @param html Raw HTML content
   * @returns Cleaned HTML
   */
  private static cleanHtml(html: string): string {
    // Remove Gmail-specific wrapper divs and quotes
    html = html.replace(/<div class="gmail_quote">[\s\S]*?<\/div>/gi, '');
    html = html.replace(/<div class="gmail_extra">[\s\S]*?<\/div>/gi, '');

    // Remove email signature blocks
    html = html.replace(/<div class="gmail_signature"[\s\S]*?<\/div>/gi, '');

    // Remove forwarded message blocks
    html = html.replace(/---------- Forwarded message ---------[\s\S]*$/gi, '');

    // Remove excessive whitespace
    html = html.replace(/\s+/g, ' ');
    html = html.trim();

    // Ensure proper HTML structure
    if (!html.match(/<html/i)) {
      html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
    }

    return html;
  }

  /**
   * Extract plain text body from a Gmail message (fallback)
   * @param message Gmail message
   * @returns Plain text content or null
   */
  static extractPlainTextBody(message: GoogleAppsScript.Gmail.GmailMessage): string | null {
    try {
      const plainText = message.getPlainBody();

      if (!plainText || plainText.trim().length === 0) {
        AppLogger.warn('No plain text body found in message');
        return null;
      }

      AppLogger.debug(`Extracted plain text body (${plainText.length} chars)`);
      return plainText;
    } catch (error) {
      AppLogger.error('Error extracting plain text body', error as Error);
      return null;
    }
  }

  /**
   * Convert plain text to HTML
   * @param plainText Plain text content
   * @returns HTML formatted content
   */
  static plainTextToHtml(plainText: string): string {
    // Escape HTML special characters
    const escaped = plainText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Convert line breaks to <br>
    const withBreaks = escaped.replace(/\n/g, '<br>');

    // Wrap in HTML
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: monospace;
      white-space: pre-wrap;
      margin: 20px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
${withBreaks}
</body>
</html>`;
  }

  /**
   * Extract best available body content from message
   * Tries HTML first, falls back to plain text
   * @param message Gmail message
   * @returns HTML content or null
   */
  static extractBody(message: GoogleAppsScript.Gmail.GmailMessage): string | null {
    // Try HTML body first
    let body = this.extractHtmlBody(message);

    // Fallback to plain text if HTML not available
    if (!body) {
      const plainText = this.extractPlainTextBody(message);
      if (plainText) {
        body = this.plainTextToHtml(plainText);
        AppLogger.info('Using plain text body (converted to HTML)');
      }
    }

    return body;
  }
}
