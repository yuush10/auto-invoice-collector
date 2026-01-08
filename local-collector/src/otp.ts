/**
 * OTP Service for Local Collector
 * Fetches OTP from Gmail API with manual terminal fallback
 */
import { google, gmail_v1 } from 'googleapis';
import * as readlineSync from 'readline-sync';

/**
 * OTP email configuration
 */
export interface OtpEmailConfig {
  subject: string;
  otpPattern: RegExp;
  maxAgeSeconds?: number;
  fromAddress?: string;
}

/**
 * IBJ-specific OTP configuration
 */
export const IBJ_OTP_CONFIG: OtpEmailConfig = {
  subject: '【ＩＢＪ事務局より】ログイン用のワンタイムパスワードのご連絡',
  otpPattern: /【ワンタイムパスワード】\s*(\d{6})/,
  maxAgeSeconds: 300,
};

/**
 * OTP Service with Gmail API and manual fallback
 */
export class OtpService {
  private gmail: gmail_v1.Gmail | null = null;
  private initialized = false;
  private targetEmail: string;

  constructor(targetEmail: string = 'info@executive-bridal.com') {
    this.targetEmail = targetEmail;
  }

  /**
   * Initialize Gmail API client
   * For local execution, uses Application Default Credentials
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    console.log(`[OTP] Initializing Gmail API for ${this.targetEmail}`);

    try {
      // Try using Application Default Credentials with impersonation
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      });

      const credentials = await auth.getCredentials();
      const serviceAccountEmail = credentials.client_email;

      if (!serviceAccountEmail) {
        console.log('[OTP] No service account found in default credentials');
        return false;
      }

      console.log(`[OTP] Using service account: ${serviceAccountEmail}`);

      // Create JWT client for domain-wide delegation
      const jwtClient = new google.auth.JWT({
        email: serviceAccountEmail,
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        subject: this.targetEmail,
      });

      await jwtClient.authorize();

      this.gmail = google.gmail({ version: 'v1', auth: jwtClient });
      this.initialized = true;

      console.log('[OTP] Gmail API initialized successfully');
      return true;
    } catch (error) {
      console.log(`[OTP] Gmail API initialization failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get OTP code - tries Gmail API first, falls back to manual entry
   */
  async getOtp(config: OtpEmailConfig = IBJ_OTP_CONFIG): Promise<string> {
    // Try Gmail API first
    const apiInitialized = await this.initialize();

    if (apiInitialized) {
      try {
        console.log('[OTP] Attempting to fetch OTP from Gmail...');
        const code = await this.waitForOtpFromGmail(config, 90000, 5000);
        console.log(`[OTP] Retrieved OTP from Gmail: ${code}`);
        return code;
      } catch (error) {
        console.log(`[OTP] Gmail fetch failed: ${(error as Error).message}`);
      }
    }

    // Fall back to manual entry
    return this.promptForManualOtp();
  }

  /**
   * Prompt user for manual OTP entry in terminal
   */
  private promptForManualOtp(): string {
    console.log('');
    console.log('='.repeat(60));
    console.log('MANUAL OTP ENTRY REQUIRED');
    console.log('');
    console.log('Gmail API is not available.');
    console.log(`Please check your email (${this.targetEmail}) for the OTP.`);
    console.log('');

    const code = readlineSync.question('Enter the 6-digit OTP code: ', {
      limit: /^\d{6}$/,
      limitMessage: 'Please enter exactly 6 digits',
    });

    console.log('='.repeat(60));
    console.log('');

    return code;
  }

  /**
   * Wait for OTP email from Gmail
   */
  private async waitForOtpFromGmail(
    config: OtpEmailConfig,
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<string> {
    const startTime = Date.now();
    const maxAgeSeconds = config.maxAgeSeconds || 300;

    console.log(`[OTP] Waiting for OTP email with subject: "${config.subject}"`);

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.checkForOtp(config, maxAgeSeconds);
      if (result) {
        return result;
      }

      console.log(`[OTP] OTP not found, retrying in ${pollIntervalMs}ms...`);
      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Timeout waiting for OTP email (${timeoutMs}ms)`);
  }

  /**
   * Check Gmail for OTP email
   */
  private async checkForOtp(config: OtpEmailConfig, maxAgeSeconds: number): Promise<string | null> {
    if (!this.gmail) {
      return null;
    }

    const queryParts: string[] = [];
    queryParts.push(`subject:"${config.subject}"`);

    if (config.fromAddress) {
      queryParts.push(`from:${config.fromAddress}`);
    }

    const afterTimestamp = Math.floor((Date.now() - maxAgeSeconds * 1000) / 1000);
    queryParts.push(`after:${afterTimestamp}`);

    const query = queryParts.join(' ');

    const listResponse = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 5,
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      return null;
    }

    for (const message of messages) {
      if (!message.id) continue;

      const code = await this.extractOtpFromMessage(message.id, config.otpPattern);
      if (code) {
        return code;
      }
    }

    return null;
  }

  /**
   * Extract OTP from email message
   */
  private async extractOtpFromMessage(messageId: string, otpPattern: RegExp): Promise<string | null> {
    if (!this.gmail) {
      return null;
    }

    const messageResponse = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = messageResponse.data;
    if (!message.payload) {
      return null;
    }

    const body = this.extractEmailBody(message.payload);
    if (!body) {
      return null;
    }

    const match = body.match(otpPattern);
    if (!match || !match[1]) {
      return null;
    }

    return match[1];
  }

  /**
   * Extract email body from message payload
   */
  private extractEmailBody(payload: gmail_v1.Schema$MessagePart): string {
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data);
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data);
        }
      }

      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = this.decodeBase64Url(part.body.data);
          return this.stripHtml(html);
        }
      }

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
   * Decode base64url string
   */
  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Strip HTML tags
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
