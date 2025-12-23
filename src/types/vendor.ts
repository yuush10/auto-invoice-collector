/**
 * Vendor-related type definitions for Phase 3
 */

/**
 * Types of authentication failures that can occur during vendor automation
 */
export type AuthFailureType =
  | 'session_expired'
  | 'login_required'
  | 'captcha_required'
  | 'mfa_required'
  | 'cookie_expired'
  | 'credentials_invalid'
  | 'account_locked'
  | 'unknown';

/**
 * Authentication status returned by Cloud Run
 */
export interface AuthStatus {
  /** Whether authentication is valid */
  authenticated: boolean;
  /** Type of failure if not authenticated */
  failureType?: AuthFailureType;
  /** Human-readable failure message */
  message?: string;
  /** Current page URL when failure detected */
  currentUrl?: string;
}

/**
 * Extended debug information with auth failure context
 */
export interface VendorDebugInfo {
  /** Screenshots captured during automation (base64 encoded) */
  screenshots?: string[];
  /** Execution logs from Puppeteer */
  logs?: string[];
  /** Total execution duration in ms */
  duration?: number;
  /** Authentication status when error occurred */
  authStatus?: AuthStatus;
}

/**
 * Vendor error with enhanced context for auth failures
 */
export interface VendorError {
  /** Error code for categorization */
  code: VendorErrorCode;
  /** Human-readable error message */
  message: string;
  /** Whether this is an auth-related failure */
  isAuthFailure: boolean;
  /** Auth failure details if applicable */
  authFailure?: AuthStatus;
  /** Recovery instructions for admin */
  recoveryInstructions?: string[];
}

/**
 * Error codes for vendor download failures
 */
export type VendorErrorCode =
  | 'AUTH_SESSION_EXPIRED'
  | 'AUTH_LOGIN_REQUIRED'
  | 'AUTH_CAPTCHA'
  | 'AUTH_MFA'
  | 'AUTH_COOKIE_EXPIRED'
  | 'AUTH_CREDENTIALS_INVALID'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DOWNLOAD_FAILED'
  | 'PARSE_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Cookie metadata for expiration tracking
 */
export interface CookieMetadata {
  /** Vendor key this cookie belongs to */
  vendorKey: string;
  /** When the cookie was last updated */
  updatedAt: Date;
  /** When the cookie expires (if known) */
  expiresAt?: Date;
  /** Days before expiration to send warning */
  warnDays: number;
  /** Whether warning has been sent for current expiration */
  warningSent: boolean;
  /** Last successful authentication check */
  lastVerified?: Date;
}

/**
 * Cookie status check result
 */
export interface CookieStatus {
  /** Vendor key */
  vendorKey: string;
  /** Whether cookie is valid */
  isValid: boolean;
  /** Days until expiration (negative if expired) */
  daysUntilExpiration?: number;
  /** Whether warning should be sent */
  shouldWarn: boolean;
  /** Human-readable status message */
  statusMessage: string;
}

/**
 * Vendor authentication notification request
 */
export interface VendorAuthNotification {
  /** Vendor key that failed */
  vendorKey: string;
  /** Vendor display name */
  vendorName: string;
  /** Type of auth failure */
  failureType: AuthFailureType;
  /** Error message */
  errorMessage: string;
  /** Screenshots from the failed automation (base64) */
  screenshots?: string[];
  /** Current URL when failure occurred */
  currentUrl?: string;
  /** Timestamp of failure */
  failedAt: Date;
  /** Recovery instructions */
  recoveryInstructions: string[];
}

/**
 * Map auth failure types to error codes
 */
export function authFailureToErrorCode(failureType: AuthFailureType): VendorErrorCode {
  const mapping: Record<AuthFailureType, VendorErrorCode> = {
    session_expired: 'AUTH_SESSION_EXPIRED',
    login_required: 'AUTH_LOGIN_REQUIRED',
    captcha_required: 'AUTH_CAPTCHA',
    mfa_required: 'AUTH_MFA',
    cookie_expired: 'AUTH_COOKIE_EXPIRED',
    credentials_invalid: 'AUTH_CREDENTIALS_INVALID',
    account_locked: 'AUTH_ACCOUNT_LOCKED',
    unknown: 'UNKNOWN_ERROR',
  };
  return mapping[failureType];
}

/**
 * Get recovery instructions for auth failure type
 */
export function getRecoveryInstructions(
  failureType: AuthFailureType,
  vendorName: string
): string[] {
  // Common cookie export and update instructions
  const cookieExportSteps = [
    '2. Cookie-Editor拡張機能でCookieをエクスポート:',
    '   - Chrome: Cookie-Editor拡張機能を開く',
    '   - 「Export」→「Export as JSON」をクリック',
    '   - JSONファイルを保存',
    '3. Secret ManagerでCookieを更新:',
    '   - GCPコンソール → Secret Manager を開く',
    '   - VENDOR_COOKIES_<VENDOR_KEY> シークレットを選択',
    '   - 「新しいバージョン」をクリックしJSONを貼り付け',
    '   - または: gcloud secrets versions add VENDOR_COOKIES_<KEY> --data-file=cookies.json',
  ];

  const instructions: Record<AuthFailureType, string[]> = {
    session_expired: [
      `[原因] ${vendorName}のセッションが期限切れです`,
      '',
      '1. ブラウザで該当サイトにログインしてください',
      ...cookieExportSteps,
    ],
    login_required: [
      `[原因] ${vendorName}へのログインが必要です`,
      '',
      '1. ブラウザで該当サイトにログインしてください',
      ...cookieExportSteps,
    ],
    captcha_required: [
      `[原因] ${vendorName}でCAPTCHA認証が要求されています`,
      '',
      '1. ブラウザで該当サイトにアクセスし、CAPTCHAを完了してください',
      ...cookieExportSteps,
      '',
      '[注意] CAPTCHAが頻発する場合、IPアドレスが制限されている可能性があります',
    ],
    mfa_required: [
      `[原因] ${vendorName}で多要素認証(MFA)が要求されています`,
      '',
      '1. ブラウザで該当サイトにログインし、MFAを完了してください',
      ...cookieExportSteps,
      '',
      '[注意] MFAトークンの有効期限設定を確認してください',
    ],
    cookie_expired: [
      `[原因] ${vendorName}のCookieが期限切れです`,
      '',
      '1. ブラウザで該当サイトにログインしてください',
      ...cookieExportSteps,
    ],
    credentials_invalid: [
      `[原因] ${vendorName}の認証情報が無効です`,
      '',
      '1. パスワードが変更されていないか確認してください',
      '2. アカウントがアクティブか確認してください',
      '3. ブラウザでログインを試み、問題を特定してください',
      '4. ログイン成功後、上記の手順でCookieを更新してください',
    ],
    account_locked: [
      `[原因] ${vendorName}のアカウントがロックされています`,
      '',
      '1. ベンダーサポートに連絡してアカウントのロック解除を依頼してください',
      '2. ロック解除後、ブラウザでログインを確認',
      ...cookieExportSteps.slice(0, 1),
      ...cookieExportSteps.slice(1),
    ],
    unknown: [
      `[原因] ${vendorName}で認証に関する問題が発生しました`,
      '',
      '1. ブラウザで該当サイトにアクセスし、状態を確認してください',
      '2. 問題を特定後、必要に応じてCookieを更新してください',
      '3. 問題が解決しない場合、Cloud Runログを確認してください',
    ],
  };
  return instructions[failureType];
}

/**
 * Patterns for detecting auth failures in error messages or page content
 */
export const AUTH_FAILURE_PATTERNS: Record<AuthFailureType, RegExp[]> = {
  session_expired: [
    /session.*expired/i,
    /セッション.*切れ/i,
    /session.*timeout/i,
    /セッション.*タイムアウト/i,
  ],
  login_required: [
    /login.*required/i,
    /please.*log.*in/i,
    /ログイン.*必要/i,
    /sign.*in.*to.*continue/i,
    /認証.*必要/i,
  ],
  captcha_required: [
    /captcha/i,
    /recaptcha/i,
    /hcaptcha/i,
    /robot.*verification/i,
    /ロボット.*確認/i,
    /画像.*認証/i,
  ],
  mfa_required: [
    /verification.*code/i,
    /two.*factor/i,
    /2fa/i,
    /mfa/i,
    /認証.*コード/i,
    /二段階.*認証/i,
    /ワンタイム.*パスワード/i,
  ],
  cookie_expired: [
    /cookie.*expired/i,
    /cookie.*invalid/i,
  ],
  credentials_invalid: [
    /invalid.*password/i,
    /incorrect.*password/i,
    /パスワード.*違/i,
    /認証.*失敗/i,
    /wrong.*credentials/i,
  ],
  account_locked: [
    /account.*locked/i,
    /account.*suspended/i,
    /アカウント.*ロック/i,
    /アカウント.*停止/i,
    /too.*many.*attempts/i,
  ],
  unknown: [],
};

/**
 * Page element selectors that indicate auth-related pages
 */
export const AUTH_PAGE_SELECTORS = {
  login: [
    'input[type="password"]',
    'form[action*="login"]',
    'form[action*="signin"]',
    'button:has-text("ログイン")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    '#login-form',
    '.login-container',
  ],
  captcha: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '[data-sitekey]',
    '.h-captcha',
  ],
  mfa: [
    'input[name*="otp"]',
    'input[name*="code"]',
    'input[name*="verification"]',
    'input[name*="totp"]',
    '[placeholder*="認証コード"]',
    '[placeholder*="verification code"]',
  ],
};

/**
 * Detect auth failure type from error message
 */
export function detectAuthFailureFromMessage(errorMessage: string): AuthFailureType | null {
  for (const [failureType, patterns] of Object.entries(AUTH_FAILURE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(errorMessage)) {
        return failureType as AuthFailureType;
      }
    }
  }
  return null;
}

/**
 * Check if an error indicates an auth failure
 */
export function isAuthFailure(errorMessage: string): boolean {
  return detectAuthFailureFromMessage(errorMessage) !== null;
}
