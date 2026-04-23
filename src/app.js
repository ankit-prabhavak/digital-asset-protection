require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const analyzeRouter   = require('./routes/analyze');
const resultsRouter   = require('./routes/results');
const originalsRouter = require('./routes/originals');
const { errorHandler } = require('./middleware/auth');
const { checkMLHealth } = require('./services/mlClient');
const { startCrawlerWatcher } = require('./jobs/crawlerWatcher');
const { db } = require('./config/firebase');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const ml = await checkMLHealth();
  res.json({
    status:     'ok',
    backend:    'running',
    ml_service: ml.ok ? 'reachable' : 'unreachable',
    ml_url:     process.env.ML_SERVICE_URL,
    ml_detail:  ml.ok ? ml.data : ml.error,
    timestamp:  new Date().toISOString(),
  });
});

app.use('/api/originals', originalsRouter);
app.use('/api/analyze',   analyzeRouter);
app.use('/api/results',   resultsRouter);

app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
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

  // ── Auto-start crawler watcher ──────────────────────────────────────────────
  // Finds the most recently indexed original from Firestore and starts watching
  // the crawler JSON file automatically. If no original exists yet, it waits.
  try {
    const snapshot = await db.collection('originals')
      .where('status', '==', 'ready')
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const orig = snapshot.docs[0].data();
      console.log(`[App] Found original: "${orig.title}" (${orig.original_id})`);
      console.log(`[App] Starting crawler watcher...\n`);
      startCrawlerWatcher(orig.original_id);
    } else {
      console.log('[App] No ready originals yet — watcher will auto-start after first upload.\n');
    }
  } catch (err) {
    console.warn('[App] Could not auto-load original ID:', err.message);
    console.warn('[App] Crawler watcher not started. Restart after uploading an original.\n');
  }
});

module.exports = app;