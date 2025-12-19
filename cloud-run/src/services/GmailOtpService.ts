/**
 * Gmail OTP Service
 * Fetches one-time passwords from Gmail for vendor login authentication
 *
 * This service uses the Gmail API to search for OTP emails and extract
 * verification codes. It's designed for vendors that require email-based
 * two-factor authentication (like IBJ).
 *
 * Authentication:
 * - Uses Application Default Credentials (ADC) or service account
 * - Requires Gmail API read access via domain-wide delegation
 * - The service account must impersonate the target email user
 */
import { google, gmail_v1 } from 'googleapis';

/**
 * Configuration for OTP email search
 */
export interface OtpEmailConfig {
  /** Email subject to search for (exact or partial match) */
  subject: string;
  /** Regex pattern to extract OTP code from email body */
  otpPattern: RegExp;
  /** Maximum age of email in seconds (default: 300 = 5 minutes) */
  maxAgeSeconds?: number;
  /** Sender email address to filter by (optional) */
  fromAddress?: string;
}

/**
 * Result of OTP extraction
 */
export interface OtpResult {
  /** The extracted OTP code */
  code: string;
  /** Email timestamp */
  timestamp: Date;
  /** Email subject (for verification) */
  subject: string;
  /** Message ID for reference */
  messageId: string;
}

/**
 * Gmail OTP Service for fetching verification codes from emails
 */
export class GmailOtpService {
  private gmail: gmail_v1.Gmail;
  private initialized = false;
  private targetEmail: string;

  /**
   * Create a new Gmail OTP Service
   * @param targetEmail The email address to check for OTP emails (e.g., info@executive-bridal.com)
   */
  constructor(targetEmail: string) {
    this.targetEmail = targetEmail;
    this.gmail = google.gmail({ version: 'v1' });
  }

  /**
   * Initialize the Gmail API client with proper authentication
   * Uses service account with domain-wide delegation to impersonate the target email
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log(`[GmailOtpService] Initializing for ${this.targetEmail}`);

    try {
      // Use Google Auth Library with domain-wide delegation
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        // For domain-wide delegation, we need to impersonate the target user
        clientOptions: {
          subject: this.targetEmail,
        },
      });

      const authClient = await auth.getClient();
      this.gmail = google.gmail({ version: 'v1', auth: authClient as any });
      this.initialized = true;

      console.log('[GmailOtpService] Initialized successfully');
    } catch (error) {
      console.error('[GmailOtpService] Initialization failed:', error);
      throw new Error(`Failed to initialize Gmail API: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for an OTP email and extract the code
   * @param config OTP email configuration
   * @param timeoutMs Maximum time to wait for the email (default: 60000ms = 1 minute)
   * @param pollIntervalMs Interval between email checks (default: 5000ms = 5 seconds)
   * @returns The extracted OTP code and metadata
   */
  async waitForOtp(
    config: OtpEmailConfig,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 5000
  ): Promise<OtpResult> {
    await this.initialize();

    const startTime = Date.now();
    const maxAgeSeconds = config.maxAgeSeconds || 300; // Default 5 minutes

    console.log(`[GmailOtpService] Waiting for OTP email with subject: "${config.subject}"`);
    console.log(`[GmailOtpService] Timeout: ${timeoutMs}ms, Max email age: ${maxAgeSeconds}s`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const result = await this.checkForOtp(config, maxAgeSeconds);
        if (result) {
          console.log(`[GmailOtpService] Found OTP: ${result.code}`);
          return result;
        }
      } catch (error) {
        console.warn(`[GmailOtpService] Error checking for OTP:`, (error as Error).message);
      }

      // Wait before next poll
      console.log(`[GmailOtpService] OTP not found, retrying in ${pollIntervalMs}ms...`);
      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Timeout waiting for OTP email (${timeoutMs}ms). Subject: "${config.subject}"`);
  }

  /**
   * Check for OTP email (single check, no waiting)
   * @param config OTP email configuration
   * @param maxAgeSeconds Maximum age of email in seconds
   * @returns OTP result if found, null otherwise
   */
  private async checkForOtp(config: OtpEmailConfig, maxAgeSeconds: number): Promise<OtpResult | null> {
    // Build Gmail search query
    const queryParts: string[] = [];

    // Subject filter (use quotes for exact phrase matching)
    queryParts.push(`subject:"${config.subject}"`);

    // From address filter
    if (config.fromAddress) {
      queryParts.push(`from:${config.fromAddress}`);
    }

    // Time filter: only emails newer than maxAgeSeconds
    const afterTimestamp = Math.floor((Date.now() - maxAgeSeconds * 1000) / 1000);
    queryParts.push(`after:${afterTimestamp}`);

    const query = queryParts.join(' ');
    console.log(`[GmailOtpService] Search query: ${query}`);

    // Search for matching emails
    const listResponse = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 5,
    });

    const messages = listResponse.data.messages || [];
    console.log(`[GmailOtpService] Found ${messages.length} matching emails`);

    if (messages.length === 0) {
      return null;
    }

    // Check each message (newest first - Gmail returns newest first by default)
    for (const message of messages) {
      if (!message.id) continue;

      try {
        const result = await this.extractOtpFromMessage(message.id, config.otpPattern);
        if (result) {
          return result;
        }
      } catch (error) {
        console.warn(`[GmailOtpService] Failed to process message ${message.id}:`, error);
      }
    }

    return null;
  }

  /**
   * Extract OTP code from a specific email message
   * @param messageId Gmail message ID
   * @param otpPattern Regex pattern to extract OTP
   * @returns OTP result if found, null otherwise
   */
  private async extractOtpFromMessage(messageId: string, otpPattern: RegExp): Promise<OtpResult | null> {
    const messageResponse = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = messageResponse.data;
    if (!message.payload) {
      return null;
    }

    // Get subject from headers
    const headers = message.payload.headers || [];
    const subjectHeader = headers.find(h => h.name?.toLowerCase() === 'subject');
    const subject = subjectHeader?.value || '';

    // Get message timestamp
    const internalDate = message.internalDate;
    const timestamp = internalDate ? new Date(parseInt(internalDate, 10)) : new Date();

    // Extract email body
    const body = this.extractEmailBody(message.payload);
    if (!body) {
      console.log(`[GmailOtpService] No body found in message ${messageId}`);
      return null;
    }

    console.log(`[GmailOtpService] Email body preview: ${body.substring(0, 200)}...`);

    // Extract OTP using the provided pattern
    const match = body.match(otpPattern);
    if (!match || !match[1]) {
      console.log(`[GmailOtpService] OTP pattern not matched in message ${messageId}`);
      return null;
    }

    const code = match[1];
    console.log(`[GmailOtpService] Extracted OTP: ${code} from message ${messageId}`);

    return {
      code,
      timestamp,
      subject,
      messageId,
    };
  }

  /**
   * Extract email body text from message payload
   * Handles both plain text and multipart messages
   */
  private extractEmailBody(payload: gmail_v1.Schema$MessagePart): string {
    // If the payload has a body with data, decode it
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }

    // If it's a multipart message, look for text/plain or text/html parts
    if (payload.parts) {
      // First, try to find text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
      }

      // Fallback to text/html if no plain text
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          // Strip HTML tags for easier pattern matching
          const html = this.decodeBase64Url(part.body.data);
          return this.stripHtml(html);
        }
      }

      // Recursively check nested parts
      for (const part of payload.parts) {
        if (part.parts) {
          const nestedBody = this.extractEmailBody(part);
          if (nestedBody) {
            return nestedBody;
          }
        }
      }
    }

    return '';
  }

  /**
   * Decode base64url encoded string
   */
  private decodeBase64Url(data: string): string {
    // Replace URL-safe characters with standard base64 characters
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Strip HTML tags from string
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * IBJ-specific OTP configuration
 * For extracting OTP from IBJ login emails
 */
export const IBJ_OTP_CONFIG: OtpEmailConfig = {
  subject: '【ＩＢＪ事務局より】ログイン用のワンタイムパスワードのご連絡',
  // Pattern to match 6-digit OTP after 【ワンタイムパスワード】
  // The OTP format is: 【ワンタイムパスワード】123456
  otpPattern: /【ワンタイムパスワード】\s*(\d{6})/,
  maxAgeSeconds: 300, // 5 minutes
};
