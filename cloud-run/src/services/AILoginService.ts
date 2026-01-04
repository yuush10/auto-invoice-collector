/**
 * AI Login Service
 *
 * Orchestrates AI-driven login automation using the browser-use Python library.
 * Spawns a Python subprocess to perform human-like login operations.
 *
 * Environment Variables:
 * - ENABLE_AI_LOGIN: Set to 'true' to enable AI login (default: false)
 * - ANTHROPIC_API_KEY: Anthropic API key (or fetched from Secret Manager)
 * - AI_LOGIN_TIMEOUT: Timeout in ms for AI login (default: 60000)
 * - AI_LOGIN_FALLBACK: Enable fallback to manual on failure (default: true)
 */
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { getSecretManager } from './SecretManager';

/**
 * Cookie structure returned by AI login
 */
export interface AICookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/**
 * Result of AI login attempt
 */
export interface AILoginResult {
  success: boolean;
  cookies?: AICookie[];
  error?: string;
  screenshots?: string[]; // Base64 encoded screenshots
  duration?: number; // Time taken in ms
}

/**
 * Configuration for AI login attempt
 */
export interface AILoginConfig {
  vendorKey: string;
  loginUrl: string;
  credentials: {
    username: string;
    password: string;
  };
  headless?: boolean;
  timeout?: number;
}

/**
 * AI Login Service - Orchestrates Python subprocess for browser-use automation
 */
export class AILoginService {
  private static instance: AILoginService;
  private pythonPath: string;
  private scriptPath: string;

  private constructor() {
    // Default Python path - can be overridden via environment
    this.pythonPath = process.env.PYTHON_PATH || 'python3';

    // Path to ai_login.py script
    // In production: /app/python/ai_login.py
    // In development: relative to project root
    this.scriptPath = process.env.AI_LOGIN_SCRIPT_PATH ||
      path.join(__dirname, '..', '..', 'python', 'ai_login.py');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AILoginService {
    if (!AILoginService.instance) {
      AILoginService.instance = new AILoginService();
    }
    return AILoginService.instance;
  }

  /**
   * Check if AI login is enabled via environment variable
   */
  isEnabled(): boolean {
    return process.env.ENABLE_AI_LOGIN === 'true';
  }

  /**
   * Check if fallback to manual mode is enabled
   */
  isFallbackEnabled(): boolean {
    // Default to true - always allow manual fallback
    return process.env.AI_LOGIN_FALLBACK !== 'false';
  }

  /**
   * Get the configured timeout for AI login attempts
   */
  getTimeout(): number {
    const timeout = parseInt(process.env.AI_LOGIN_TIMEOUT || '60000', 10);
    return isNaN(timeout) ? 60000 : timeout;
  }

  /**
   * Get Anthropic API key from environment or Secret Manager
   */
  async getAnthropicApiKey(): Promise<string | null> {
    // First check environment variable
    if (process.env.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }

    // Try to get from Secret Manager
    try {
      const secretManager = getSecretManager();
      const isAvailable = await secretManager.isAvailable();

      if (isAvailable) {
        // Fetch API key secret
        const response = await secretManager.getCredentials('anthropic-api-key');
        // The secret might store just the key or as a JSON with 'apiKey' field
        if (typeof response === 'string') {
          return response;
        }
        if (response && 'apiKey' in response) {
          return (response as { apiKey: string }).apiKey;
        }
        // If stored as username (common pattern)
        if (response.username) {
          return response.username;
        }
      }
    } catch (error) {
      console.warn('[AILoginService] Failed to get API key from Secret Manager:', error);
    }

    return null;
  }

  /**
   * Attempt AI-driven login
   *
   * @param config Login configuration
   * @returns Result with success status, cookies, or error
   */
  async attemptLogin(config: AILoginConfig): Promise<AILoginResult> {
    const startTime = Date.now();
    const timeout = config.timeout || this.getTimeout();

    console.log(`[AILoginService] Starting AI login for ${config.vendorKey}`);
    console.log(`[AILoginService] Login URL: ${config.loginUrl}`);
    console.log(`[AILoginService] Timeout: ${timeout}ms`);

    // Get API key
    const apiKey = await this.getAnthropicApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY or add to Secret Manager.',
        duration: Date.now() - startTime,
      };
    }

    // Validate credentials
    if (!config.credentials.username || !config.credentials.password) {
      return {
        success: false,
        error: 'Credentials not provided',
        duration: Date.now() - startTime,
      };
    }

    return new Promise((resolve) => {
      const args = [
        this.scriptPath,
        '--vendor', config.vendorKey,
        '--login-url', config.loginUrl,
      ];

      if (config.headless === false) {
        args.push('--no-headless');
      }

      console.log(`[AILoginService] Spawning Python process: ${this.pythonPath} ${args.join(' ')}`);

      const pythonProcess: ChildProcess = spawn(this.pythonPath, args, {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: apiKey,
          IBJ_USERNAME: config.credentials.username,
          IBJ_PASSWORD: config.credentials.password,
        },
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      pythonProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        // Log stderr in real-time for debugging
        console.log(`[AILoginService] Python stderr: ${data.toString().trim()}`);
      });

      // Handle timeout
      const timeoutHandle = setTimeout(() => {
        console.log('[AILoginService] Timeout reached, killing Python process');
        pythonProcess.kill('SIGTERM');
        resolve({
          success: false,
          error: `AI login timed out after ${timeout}ms`,
          duration: Date.now() - startTime,
        });
      }, timeout);

      pythonProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        console.log(`[AILoginService] Python process exited with code ${code}`);
        console.log(`[AILoginService] Duration: ${duration}ms`);

        if (code === 0) {
          try {
            // Parse JSON output from Python script
            const result = JSON.parse(stdout.trim());

            if (result.success) {
              console.log(`[AILoginService] AI login successful, got ${result.cookies?.length || 0} cookies`);
              resolve({
                success: true,
                cookies: result.cookies || [],
                screenshots: result.screenshots,
                duration,
              });
            } else {
              console.log(`[AILoginService] AI login failed: ${result.error}`);
              resolve({
                success: false,
                error: result.error || 'Unknown error from AI login',
                screenshots: result.screenshots,
                duration,
              });
            }
          } catch (parseError) {
            console.error('[AILoginService] Failed to parse Python output:', stdout);
            resolve({
              success: false,
              error: `Failed to parse AI login result: ${(parseError as Error).message}`,
              duration,
            });
          }
        } else {
          // Non-zero exit code
          const errorMessage = stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
          console.error(`[AILoginService] AI login failed: ${errorMessage}`);
          resolve({
            success: false,
            error: errorMessage,
            duration,
          });
        }
      });

      pythonProcess.on('error', (error: Error) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        console.error('[AILoginService] Failed to spawn Python process:', error);
        resolve({
          success: false,
          error: `Failed to start AI login process: ${error.message}`,
          duration,
        });
      });
    });
  }
}

// Export singleton getter for convenience
export function getAILoginService(): AILoginService {
  return AILoginService.getInstance();
}
