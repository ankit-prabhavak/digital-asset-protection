const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { createDocument, updateDocument, getDocument, listDocuments } = require('../config/firebase');
const { indexOriginalVideo } = require('../services/mlClient');

/**
 * POST /api/originals
 * Sports org uploads an original video for indexing.
 * Frontend calls this once per protected asset.
 *
 * Body: { video_url, title, sport?, event? }
 */
router.post('/', async (req, res, next) => {
  try {
    const { video_url, title, sport = 'unknown', event = '' } = req.body;

    if (!video_url || !title) {
      return res.status(400).json({ error: 'video_url and title are required' });
    }

    const originalId = uuidv4();
    const now = new Date().toISOString();

    // Save to Firestore immediately with 'indexing' status
    await createDocument('originals', originalId, {
      original_id: originalId,
      title,
      sport,
      event,
      video_url,
      status: 'indexing',      // indexing → ready
      created_at: now,
    });

    // Tell ML to build the FAISS index (async — don't await in response)
    indexOriginalVideo(originalId, video_url)
      .then(async () => {
        await updateDocument('originals', originalId, {
          status: 'ready',
          indexed_at: new Date().toISOString(),
        });
        console.log(`[Originals] Index ready for: ${originalId}`);
      })
      .catch(async (err) => {
        await updateDocument('originals', originalId, {
          status: 'failed',
          error: err.message,
        });
        console.error(`[Originals] Indexing failed for ${originalId}:`, err.message);
      });

    // Respond immediately — indexing happens in background
    res.status(202).json({
      original_id: originalId,
      status: 'indexing',
      message: 'Video received. ML indexing started in background.',
    });

  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/originals
 * List all indexed original videos (for frontend dropdown when submitting a scan).
 */
router.get('/', async (req, res, next) => {
  try {
    const originals = await listDocuments('originals', {
      orderBy: 'created_at',
      orderDir: 'desc',
      limit: 100,
    });
    res.json(originals);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/originals/:originalId
 * Get status of a specific original (check if indexing is done).
 */
router.get('/:originalId', async (req, res, next) => {
  try {
    const doc = await getDocument('originals', req.params.originalId);
    if (!doc) return res.status(404).json({ error: 'Original not found' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

module.exports = router;