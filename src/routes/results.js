const express = require('express');
const router = express.Router();

const { getDocument, listDocuments } = require('../config/firebase');

/**
 * GET /api/results
 * List all analysis jobs — used by dashboard.
 *
 * Query params:
 *   ?status=completed|failed|processing
 *   ?limit=50
 *   ?source=telegram|website|manual
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, source } = req.query;

    const options = {
      orderBy: 'created_at',
      orderDir: 'desc',
      limit: Math.min(parseInt(limit), 200),
    };

    // Filter by status if provided
    if (status) {
      options.where = { field: 'status', op: '==', value: status };
    }
    if (source) {
      options.where = { field: 'source', op: '==', value: source };
    }

    const results = await listDocuments('analyses', options);

    // Summary stats for dashboard cards
    const summary = {
      total: results.length,
      pirated: results.filter(r => r.is_pirated === true).length,
      clean:   results.filter(r => r.is_pirated === false).length,
      pending: results.filter(r => r.status === 'processing' || r.status === 'analyzing').length,
    };

    res.json({ summary, results });

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/results/:jobId
 * Get a single job's full result.
 * Frontend polls this after submitting a URL until status is 'completed' or 'failed'.
 */
router.get('/:jobId', async (req, res, next) => {
  try {
    const doc = await getDocument('analyses', req.params.jobId);
    if (!doc) return res.status(404).json({ error: 'Job not found' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

module.exports = router;