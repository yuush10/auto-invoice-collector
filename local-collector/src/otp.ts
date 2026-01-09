/**
 * OTP Service for Local Collector
 * Fetches OTP from Gmail API using OAuth2 with user consent
 */
import { google, gmail_v1 } from 'googleapis';
import * as readlineSync from 'readline-sync';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as url from 'url';

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
 * OAuth2 credentials structure
 */
interface OAuth2Credentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

/**
 * Stored tokens structure
 */
interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

// OAuth2 scopes needed for Gmail
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// Config directory for storing credentials and tokens
const CONFIG_DIR = path.join(process.env.HOME || '', '.local-collector');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'gmail-credentials.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'gmail-token.json');

/**
 * OTP Service with Gmail API OAuth2 and manual fallback
 */
export class OtpService {
  private gmail: gmail_v1.Gmail | null = null;
  private initialized = false;
  private targetEmail: string;

  constructor(targetEmail: string = 'info@executive-bridal.com') {
    this.targetEmail = targetEmail;
  }

  /**
   * Initialize Gmail API client using OAuth2
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    console.log(`[OTP] Initializing Gmail API for ${this.targetEmail}`);

    try {
      // Check if credentials file exists
      if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.log('[OTP] Gmail credentials not found.');
        console.log(`[OTP] Please create credentials at: ${CREDENTIALS_PATH}`);
        this.printCredentialsSetupInstructions();
        return false;
      }

      // Load credentials
      const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      const credentials = JSON.parse(credentialsContent);
      const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web as OAuth2Credentials;

      // Create OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0] || 'http://localhost:3000/oauth2callback'
      );

      // Check for existing token
      if (fs.existsSync(TOKEN_PATH)) {
        const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
        const tokens = JSON.parse(tokenContent) as StoredTokens;
        oauth2Client.setCredentials(tokens);

        // Check if token is expired
        if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
          console.log('[OTP] Token expired, refreshing...');
          try {
            const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(newCredentials);
            this.saveToken(newCredentials as StoredTokens);
          } catch (refreshError) {
            console.log('[OTP] Token refresh failed, need to re-authorize');
            await this.authorizeOAuth2(oauth2Client);
          }
        }
      } else {
        // No token, need to authorize
        await this.authorizeOAuth2(oauth2Client);
      }

      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      this.initialized = true;

      console.log('[OTP] Gmail API initialized successfully');
      return true;
    } catch (error) {
      console.log(`[OTP] Gmail API initialization failed: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Run OAuth2 authorization flow
   */
  private async authorizeOAuth2(oauth2Client: InstanceType<typeof google.auth.OAuth2>): Promise<void> {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent to get refresh token
    });

    console.log('');
    console.log('='.repeat(60));
    console.log('GMAIL AUTHORIZATION REQUIRED');
    console.log('');
    console.log('Opening browser for Gmail authorization...');
    console.log('If browser does not open, visit this URL:');
    console.log('');
    console.log(authUrl);
    console.log('='.repeat(60));
    console.log('');

    // Try to open browser
    const { exec } = await import('child_process');
    exec(`open "${authUrl}"`);

    // Start local server to receive callback
    const code = await this.waitForAuthCode();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save tokens
    this.saveToken(tokens as StoredTokens);

    console.log('[OTP] Gmail authorization successful!');
  }

  /**
   * Wait for OAuth2 callback with authorization code
   */
  private waitForAuthCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || '', true);

        if (parsedUrl.pathname === '/oauth2callback') {
          const code = parsedUrl.query.code as string;
          const error = parsedUrl.query.error as string;

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
            server.close();
            reject(new Error(`Authorization failed: ${error}`));
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
              <head><title>Authorization Successful</title></head>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>✅ Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </body>
              </html>
            `);
            server.close();
            resolve(code);
            return;
          }
        }

        res.writeHead(404);
        res.end('Not found');
      });

      server.listen(3000, () => {
        console.log('[OTP] Waiting for authorization on http://localhost:3000/oauth2callback ...');
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Authorization timeout'));
      }, 120000);
    });
  }

  /**
   * Save tokens to file
   */
  private saveToken(tokens: StoredTokens): void {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`[OTP] Token saved to ${TOKEN_PATH}`);
  }

  /**
   * Print instructions for setting up credentials
   */
  private printCredentialsSetupInstructions(): void {
    console.log('');
    console.log('='.repeat(60));
    console.log('GMAIL CREDENTIALS SETUP');
    console.log('='.repeat(60));
    console.log('');
    console.log('1. Go to Google Cloud Console:');
    console.log('   https://console.cloud.google.com/apis/credentials');
    console.log('');
    console.log('2. Create OAuth 2.0 Client ID:');
    console.log('   - Application type: Desktop app');
    console.log('   - Name: Local Collector');
    console.log('');
    console.log('3. Download the JSON credentials');
    console.log('');
    console.log('4. Save as:');
    console.log(`   ${CREDENTIALS_PATH}`);
    console.log('');
    console.log('5. Run the collector again');
    console.log('='.repeat(60));
    console.log('');
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

      console.log(`[OTP] OTP not found, retrying in ${pollIntervalMs / 1000}s...`);
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
