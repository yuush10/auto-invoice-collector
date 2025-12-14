import express from 'express';
import cors from 'cors';
import { iamAuth } from './middleware/auth';
import convertRouter from './routes/convert';

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large HTML payloads

// Apply IAM authentication to all routes except /health
app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  iamAuth(req, res, next);
});

// Routes
app.use('/', convertRouter);

// Start server
app.listen(port, () => {
  console.log(`[SERVER] Email-to-PDF service listening on port ${port}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'production'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully');
  process.exit(0);
});
