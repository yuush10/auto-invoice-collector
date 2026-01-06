import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { Socket } from 'net';
import { createProxyMiddleware } from 'http-proxy-middleware';
import convertRouter from './routes/convert';
import downloadRouter from './routes/download';
import interactiveRouter from './routes/interactive';
import { getVncSessionManager } from './services/VncSessionManager';

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large HTML payloads

// Authentication for non-VNC routes is handled by Cloud Run IAM
// VNC routes use token-in-URL authentication (see middleware below)

// VNC session token validation middleware
// Only validates token for vnc.html entry point - static assets pass through
// WebSocket connections are validated separately in the 'upgrade' handler
const vncAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Only validate token for the main vnc.html page
  // Static assets (app/*, core/*, vendor/*) don't need token validation
  const path = req.path;
  if (!path.endsWith('vnc.html') && !path.endsWith('vnc_lite.html')) {
    // Allow static assets through without token
    return next();
  }

  const sessionId = req.query.sessionId as string;
  const token = req.query.token as string;

  if (!sessionId || !token) {
    console.log(`[VNC Auth] Missing credentials for ${path}: sessionId=${!!sessionId}, token=${!!token}`);
    return res.status(401).json({ error: 'Missing session credentials' });
  }

  const manager = getVncSessionManager();
  const session = manager.validateSessionToken(sessionId, token);

  if (!session) {
    console.log(`[VNC Auth] Invalid session or token: sessionId=${sessionId}`);
    return res.status(403).json({ error: 'Invalid or expired session' });
  }

  console.log(`[VNC Auth] Session validated: ${sessionId}`);
  next();
};

// noVNC websocket proxy - proxies /vnc/* to websockify on port 6080
const vncProxy = createProxyMiddleware({
  target: 'http://localhost:6080',
  ws: true,
  changeOrigin: true,
  pathRewrite: {
    '^/vnc/': '/',  // /vnc/vnc.html -> /vnc.html
  },
  on: {
    proxyReq: (proxyReq, req) => {
      console.log(`[VNC Proxy] ${req.method} ${req.url} -> ${proxyReq.path}`);
    },
  },
});

// Apply auth middleware before VNC proxy
app.use('/vnc', vncAuthMiddleware, vncProxy);

// Routes
app.use('/', convertRouter);
app.use('/', downloadRouter);
app.use('/', interactiveRouter);

// Create HTTP server to handle websocket upgrades
const server = http.createServer(app);

// Handle websocket upgrade for VNC proxy
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/vnc')) {
    // Validate session token for websocket upgrades
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    const token = url.searchParams.get('token');

    if (!sessionId || !token) {
      console.log(`[VNC WS Auth] Missing credentials`);
      socket.destroy();
      return;
    }

    const manager = getVncSessionManager();
    const session = manager.validateSessionToken(sessionId, token);

    if (!session) {
      console.log(`[VNC WS Auth] Invalid session: ${sessionId}`);
      socket.destroy();
      return;
    }

    console.log(`[VNC WS Auth] Session validated for websocket: ${sessionId}`);
    vncProxy.upgrade(req, socket as Socket, head);
  }
});

// Start server
server.listen(port, () => {
  console.log(`[SERVER] Invoice Automation Service listening on port ${port}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`[SERVER] Available endpoints: /convert, /download, /interactive, /vnc, /health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });
});
