require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const analyzeRouter   = require('./routes/analyze');
const resultsRouter   = require('./routes/results');
const originalsRouter = require('./routes/originals');
const { crawlerAuth, errorHandler } = require('./middleware/auth');
const { checkMLHealth } = require('./services/mlClient');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // HTTP request logging

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check (no auth)
app.get('/health', async (req, res) => {
  const ml = await checkMLHealth();
  res.json({
    status: 'ok',
    backend: 'running',
    ml_service: ml.ok ? 'reachable' : 'unreachable',
    ml_detail: ml.ok ? ml.data : ml.error,
    timestamp: new Date().toISOString(),
  });
});

// Original videos — upload & index protected assets (frontend, no crawler auth needed)
app.use('/api/originals', originalsRouter);

// Analysis jobs — crawlers use API key auth, frontend can call too
app.use('/api/analyze', crawlerAuth, analyzeRouter);

// Results — public read for dashboard
app.use('/api/results', resultsRouter);

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Piracy Detector Backend                ║
║   Running on http://localhost:${PORT}       ║
╚══════════════════════════════════════════╝

  POST  /api/originals         Upload original video for indexing
  GET   /api/originals         List all indexed originals
  POST  /api/analyze           Submit suspected pirated URL
  GET   /api/results           Dashboard — all jobs
  GET   /api/results/:jobId    Poll single job status
  GET   /health                Backend + ML health check
`);
});

module.exports = app;