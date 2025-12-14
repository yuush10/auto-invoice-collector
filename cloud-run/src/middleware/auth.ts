import { Request, Response, NextFunction } from 'express';

/**
 * IAM authentication middleware for Cloud Run
 *
 * Cloud Run automatically validates the JWT token when the service is configured
 * with `--no-allow-unauthenticated`. The token is validated before the request
 * reaches this application.
 *
 * This middleware provides additional validation and logging.
 */
export function iamAuth(req: Request, res: Response, next: NextFunction): void {
  // In production Cloud Run with --no-allow-unauthenticated:
  // - Unauthenticated requests are rejected by Cloud Run (never reach here)
  // - Authenticated requests include validated headers

  // Check if running in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment) {
    console.log('[AUTH] Development mode - skipping authentication');
    return next();
  }

  // In production, Cloud Run has already validated the token
  // We can optionally check for additional headers or logging
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[AUTH] Missing or invalid authorization header');
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization token'
      }
    });
    return;
  }

  // Log the authenticated request (without exposing token)
  console.log('[AUTH] Authenticated request from:', req.headers['x-forwarded-for'] || req.ip);

  next();
}
