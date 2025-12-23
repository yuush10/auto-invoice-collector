import express from 'express';
import cors from 'cors';
import convertRouter from './routes/convert';
import downloadRouter from './routes/download';

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large HTML payloads

// Note: Authentication is handled by Cloud Run IAM with --no-allow-unauthenticated
// Cloud Run validates ID tokens before requests reach this application

// Routes
app.use('/', convertRouter);
app.use('/', downloadRouter);

// Start server
app.listen(port, () => {
  console.log(`[SERVER] Invoice Automation Service listening on port ${port}`);
  console.log(`[SERVER] Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`[SERVER] Available endpoints: /convert, /download, /health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully');
  process.exit(0);
});
