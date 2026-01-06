/**
 * Interactive Route
 * Handles VNC-based interactive vendor processing
 */

import { Router, Request, Response } from 'express';
import { getVncSessionManager, VncSession } from '../services/VncSessionManager';
import { getVendor } from '../vendors';

const router = Router();

/**
 * POST /interactive/start
 * Start an interactive VNC session for vendor processing
 */
router.post('/interactive/start', async (req: Request, res: Response) => {
  try {
    const { vendorKey, recordId, token } = req.body;

    if (!vendorKey || !recordId || !token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: vendorKey, recordId, token',
      });
    }

    // Validate vendor exists
    const vendor = getVendor(vendorKey);
    if (!vendor) {
      return res.status(400).json({
        success: false,
        error: `Unknown vendor: ${vendorKey}`,
      });
    }

    console.log(`[Interactive] Starting session for vendor: ${vendorKey}, record: ${recordId}`);

    // Start VNC session
    const manager = getVncSessionManager();
    const session = await manager.startSession({
      vendorKey,
      recordId,
      token,
      timeoutMinutes: 30,
    });

    // Navigate to vendor login page
    if (session.page) {
      const loginUrl = vendor.loginUrl;
      console.log(`[Interactive] Navigating to: ${loginUrl}`);
      await session.page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000  // 60 seconds for slow pages
      });
    }

    res.json({
      success: true,
      sessionId: session.sessionId,
      noVncUrl: session.noVncUrl,
      expiresAt: session.expiresAt.toISOString(),
      message: `VNC session started. Open ${session.noVncUrl} to access the browser.`,
    });
  } catch (error) {
    console.error('[Interactive] Error starting session:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /interactive/status/:sessionId
 * Get status of a VNC session
 */
router.get('/interactive/status/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const manager = getVncSessionManager();
    const session = manager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        vendorKey: session.vendorKey,
        recordId: session.recordId,
        status: session.status,
        noVncUrl: session.noVncUrl,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Interactive] Error getting status:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /interactive/continue/:sessionId
 * Signal that user has completed manual steps, continue automation
 */
router.post('/interactive/continue/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const manager = getVncSessionManager();
    const session = manager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: `Cannot continue: session status is ${session.status}`,
      });
    }

    console.log(`[Interactive] Continuing automation for session: ${sessionId}`);
    manager.setProcessing(sessionId);

    // Get the vendor and continue automation
    const vendor = getVendor(session.vendorKey);
    if (!vendor || !session.page) {
      return res.status(500).json({
        success: false,
        error: 'Vendor or page not available',
      });
    }

    // Continue with vendor-specific automation (OTP, download, etc.)
    // This will be handled by the vendor implementation
    // For now, we just acknowledge the continue request

    res.json({
      success: true,
      message: 'Automation continuing. Monitor session status for completion.',
    });
  } catch (error) {
    console.error('[Interactive] Error continuing session:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /interactive/complete/:sessionId
 * Mark session as completed
 */
router.post('/interactive/complete/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const manager = getVncSessionManager();

    await manager.completeSession(sessionId);

    res.json({
      success: true,
      message: 'Session completed and cleaned up',
    });
  } catch (error) {
    console.error('[Interactive] Error completing session:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /interactive/fail/:sessionId
 * Mark session as failed
 */
router.post('/interactive/fail/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { error: errorMessage } = req.body;
    const manager = getVncSessionManager();

    await manager.failSession(sessionId, errorMessage || 'Unknown error');

    res.json({
      success: true,
      message: 'Session marked as failed and cleaned up',
    });
  } catch (error) {
    console.error('[Interactive] Error failing session:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /interactive/sessions
 * List all active VNC sessions
 */
router.get('/interactive/sessions', (_req: Request, res: Response) => {
  try {
    const manager = getVncSessionManager();
    const sessions = manager.getActiveSessions();

    res.json({
      success: true,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        vendorKey: s.vendorKey,
        recordId: s.recordId,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[Interactive] Error listing sessions:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

export default router;
