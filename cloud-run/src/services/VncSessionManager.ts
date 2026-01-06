/**
 * VNC Session Manager
 * Manages interactive browser sessions accessible via noVNC
 */

import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * VNC Session information
 */
export interface VncSession {
  /** Unique session ID */
  sessionId: string;
  /** Secure session token for browser access authentication */
  sessionToken: string;
  /** Vendor key being processed */
  vendorKey: string;
  /** Record ID from pending queue */
  recordId: string;
  /** Display number (e.g., :99) */
  display: number;
  /** VNC port */
  vncPort: number;
  /** WebSocket port for noVNC */
  websocketPort: number;
  /** noVNC URL for browser access */
  noVncUrl: string;
  /** Session status */
  status: 'starting' | 'active' | 'processing' | 'completed' | 'failed';
  /** Created timestamp */
  createdAt: Date;
  /** Expiry timestamp */
  expiresAt: Date;
  /** Puppeteer browser instance */
  browser?: Browser;
  /** Current page */
  page?: Page;
  /** Xvfb process */
  xvfbProcess?: ChildProcess;
  /** x11vnc process */
  vncProcess?: ChildProcess;
  /** websockify process */
  websockifyProcess?: ChildProcess;
}

/**
 * Session start options
 */
export interface StartSessionOptions {
  vendorKey: string;
  recordId: string;
  token: string;
  timeoutMinutes?: number;
}

/**
 * VNC Session Manager
 * Singleton that manages all active VNC sessions
 */
export class VncSessionManager {
  private sessions: Map<string, VncSession> = new Map();
  // Fixed ports - only one session per container (proxy limitation)
  private readonly DISPLAY_NUMBER = 99;
  private readonly VNC_PORT = 5900;
  private readonly WEBSOCKET_PORT = 6080;

  /**
   * Start a new interactive VNC session
   * Note: Only one session per container due to fixed proxy port
   */
  async startSession(options: StartSessionOptions): Promise<VncSession> {
    // Check if there's already an active session
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length > 0) {
      throw new Error('A VNC session is already active. Complete or fail the existing session first.');
    }

    const sessionId = this.generateSessionId();
    const sessionToken = this.generateSessionToken();
    // Use fixed ports - only one session per container
    const display = this.DISPLAY_NUMBER;
    const vncPort = this.VNC_PORT;
    const websocketPort = this.WEBSOCKET_PORT;
    const timeoutMinutes = options.timeoutMinutes || 30;

    console.log(`[VNC] Starting session ${sessionId} for vendor ${options.vendorKey}`);

    const session: VncSession = {
      sessionId,
      sessionToken,
      vendorKey: options.vendorKey,
      recordId: options.recordId,
      display,
      vncPort,
      websocketPort,
      noVncUrl: '', // Will be set after processes start
      status: 'starting',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMinutes * 60 * 1000),
    };

    this.sessions.set(sessionId, session);

    try {
      // Start Xvfb (virtual frame buffer)
      await this.startXvfb(session);

      // Start x11vnc
      await this.startVnc(session);

      // Start websockify for noVNC
      await this.startWebsockify(session);

      // Start Puppeteer browser on the virtual display
      await this.startBrowser(session);

      // Generate noVNC URL
      session.noVncUrl = this.generateNoVncUrl(session);
      session.status = 'active';

      console.log(`[VNC] Session ${sessionId} started successfully`);
      console.log(`[VNC] noVNC URL: ${session.noVncUrl}`);

      // Schedule session cleanup
      this.scheduleCleanup(sessionId, timeoutMinutes);

      return session;
    } catch (error) {
      console.error(`[VNC] Failed to start session ${sessionId}:`, error);
      await this.cleanupSession(sessionId);
      throw error;
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): VncSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Mark session as processing
   */
  setProcessing(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'processing';
    }
  }

  /**
   * Mark session as completed
   */
  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'completed';
      await this.cleanupSession(sessionId);
    }
  }

  /**
   * Mark session as failed
   */
  async failSession(sessionId: string, error: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'failed';
      console.error(`[VNC] Session ${sessionId} failed: ${error}`);
      await this.cleanupSession(sessionId);
    }
  }

  /**
   * Start Xvfb virtual display
   */
  private async startXvfb(session: VncSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const displayStr = `:${session.display}`;
      console.log(`[VNC] Starting Xvfb on display ${displayStr}`);

      // Use 1280x720 for better fit on laptop screens
      const xvfb = spawn('Xvfb', [
        displayStr,
        '-screen', '0', '1280x720x24',
        '-ac',
        '-nolisten', 'tcp',
      ]);

      session.xvfbProcess = xvfb;

      xvfb.stderr.on('data', (data) => {
        console.log(`[Xvfb] ${data}`);
      });

      xvfb.on('error', (err) => {
        reject(new Error(`Failed to start Xvfb: ${err.message}`));
      });

      // Give Xvfb time to start
      setTimeout(() => {
        if (xvfb.killed) {
          reject(new Error('Xvfb process died'));
        } else {
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Start x11vnc server
   */
  private async startVnc(session: VncSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const displayStr = `:${session.display}`;
      console.log(`[VNC] Starting x11vnc on display ${displayStr}, port ${session.vncPort}`);

      const vnc = spawn('x11vnc', [
        '-display', displayStr,
        '-rfbport', String(session.vncPort),
        '-forever',
        '-shared',
        '-nopw',
        '-noxdamage',
        '-cursor', 'arrow',
      ]);

      session.vncProcess = vnc;

      vnc.stdout.on('data', (data) => {
        console.log(`[x11vnc] ${data}`);
      });

      vnc.stderr.on('data', (data) => {
        console.log(`[x11vnc] ${data}`);
      });

      vnc.on('error', (err) => {
        reject(new Error(`Failed to start x11vnc: ${err.message}`));
      });

      // Give VNC time to start
      setTimeout(() => {
        if (vnc.killed) {
          reject(new Error('x11vnc process died'));
        } else {
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Start websockify for noVNC access
   */
  private async startWebsockify(session: VncSession): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[VNC] Starting websockify on port ${session.websocketPort} -> VNC ${session.vncPort}`);

      // Use websockify from novnc package
      const websockify = spawn('websockify', [
        '--web', '/usr/share/novnc',
        String(session.websocketPort),
        `localhost:${session.vncPort}`,
      ]);

      session.websockifyProcess = websockify;

      websockify.stdout.on('data', (data) => {
        console.log(`[websockify] ${data}`);
      });

      websockify.stderr.on('data', (data) => {
        console.log(`[websockify] ${data}`);
      });

      websockify.on('error', (err) => {
        reject(new Error(`Failed to start websockify: ${err.message}`));
      });

      // Give websockify time to start
      setTimeout(() => {
        if (websockify.killed) {
          reject(new Error('websockify process died'));
        } else {
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Start Puppeteer browser on virtual display
   */
  private async startBrowser(session: VncSession): Promise<void> {
    const displayStr = `:${session.display}`;
    console.log(`[VNC] Starting Puppeteer browser on display ${displayStr}`);

    process.env.DISPLAY = displayStr;

    session.browser = await puppeteer.launch({
      headless: false, // Must be non-headless for VNC
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--display=${displayStr}`,
        '--window-size=1280,720',
        // Anti-detection flags to reduce reCAPTCHA suspicion
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    session.page = await session.browser.newPage();
    await session.page.setViewport({ width: 1280, height: 670 });

    // Hide webdriver property to reduce automation detection
    // Use string form to avoid TypeScript errors with browser globals
    await session.page.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    `);

    console.log(`[VNC] Browser started successfully`);
  }

  /**
   * Generate noVNC URL for client access
   * Includes sessionId and token for authentication
   */
  private generateNoVncUrl(session: VncSession): string {
    const authParams = `sessionId=${session.sessionId}&token=${session.sessionToken}`;
    // Check if running on Cloud Run (K_SERVICE is set by Cloud Run)
    if (process.env.K_SERVICE) {
      // Use Load Balancer URL for browser access (bypasses Cloud Run IAM)
      // LOAD_BALANCER_URL should be set to the LB domain (e.g., https://vnc.executive-bridal.com)
      const lbUrl = process.env.LOAD_BALANCER_URL || 'https://vnc.executive-bridal.com';
      return `${lbUrl}/vnc/vnc.html?${authParams}&autoconnect=true&resize=remote`;
    }
    // Local development - direct websocket access
    return `http://localhost:${session.websocketPort}/vnc.html?${authParams}&autoconnect=true&resize=remote`;
  }

  /**
   * Schedule session cleanup after timeout
   */
  private scheduleCleanup(sessionId: string, timeoutMinutes: number): void {
    setTimeout(async () => {
      const session = this.sessions.get(sessionId);
      if (session && session.status !== 'completed') {
        console.log(`[VNC] Session ${sessionId} timed out, cleaning up`);
        await this.cleanupSession(sessionId);
      }
    }, timeoutMinutes * 60 * 1000);
  }

  /**
   * Cleanup a session and all its processes
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`[VNC] Cleaning up session ${sessionId}`);

    // Close browser
    if (session.browser) {
      try {
        await session.browser.close();
      } catch (e) {
        console.log(`[VNC] Error closing browser: ${e}`);
      }
    }

    // Kill processes
    const killProcess = (proc: ChildProcess | undefined, name: string) => {
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGTERM');
          console.log(`[VNC] Killed ${name} process`);
        } catch (e) {
          console.log(`[VNC] Error killing ${name}: ${e}`);
        }
      }
    };

    killProcess(session.websockifyProcess, 'websockify');
    killProcess(session.vncProcess, 'x11vnc');
    killProcess(session.xvfbProcess, 'Xvfb');

    this.sessions.delete(sessionId);
    console.log(`[VNC] Session ${sessionId} cleaned up`);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): VncSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.status === 'active' || s.status === 'processing'
    );
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `vnc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Generate cryptographically secure session token
   */
  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Validate session token
   * Returns the session if valid, undefined otherwise
   */
  validateSessionToken(sessionId: string, token: string): VncSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    if (session.sessionToken !== token) {
      return undefined;
    }
    // Check if session has expired
    if (new Date() > session.expiresAt) {
      return undefined;
    }
    return session;
  }

}

// Export singleton instance
let managerInstance: VncSessionManager | null = null;

export function getVncSessionManager(): VncSessionManager {
  if (!managerInstance) {
    managerInstance = new VncSessionManager();
  }
  return managerInstance;
}
