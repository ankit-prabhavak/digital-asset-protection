const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const { createDocument, updateDocument, uploadFile } = require('../config/firebase');
const { extractClip, cleanupTempFile } = require('../services/ffmpeg');
const { analyzeClip, checkMLHealth } = require('../services/mlClient');

/**
 * POST /api/analyze
 * Main endpoint — receives a suspected pirated video URL from crawler or frontend.
 * Responds immediately with job_id, then processes asynchronously.
 *
 * Body: {
 *   video_url:   "https://t.me/...",
 *   original_id: "uuid-of-original-video",
 *   source:      "telegram" | "website" | "manual",
 *   notes?:      "found in group XYZ"
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const { video_url, original_id, source = 'unknown', notes = '' } = req.body;

    if (!video_url) {
      return res.status(400).json({ error: 'video_url is required' });
    }
    if (!original_id) {
      return res.status(400).json({ error: 'original_id is required — which original video to compare against?' });
    }

    // Optional: verify ML service is reachable before accepting job
    const mlHealth = await checkMLHealth();
    if (!mlHealth.ok) {
      return res.status(503).json({
        error: 'ML service is currently unavailable',
        details: mlHealth.error,
      });
    }

    const jobId = uuidv4();
    const now = new Date().toISOString();

    // Immediately acknowledge with job ID
    res.status(202).json({
      job_id: jobId,
      status: 'processing',
      message: 'Job accepted. Poll /api/results/' + jobId + ' for updates.',
    });

    // Save initial record to Firestore
    await createDocument('analyses', jobId, {
      job_id: jobId,
      video_url,
      original_id,
      source,
      notes,
      status: 'processing',
      created_at: now,
    });

    // ── Async processing pipeline ─────────────────────────────────────────────
    processJob({ jobId, video_url, original_id });

  } catch (err) {
    next(err);
  }
});

/**
 * Full processing pipeline — runs in background after 202 response is sent.
 */
async function processJob({ jobId, video_url, original_id }) {
  let localClipPath = null;

  try {
    console.log(`\n[Job ${jobId}] ── Starting pipeline ──`);

    // Step 1: Extract 60s clip using FFmpeg
    console.log(`[Job ${jobId}] Step 1: Extracting clip...`);
    localClipPath = await extractClip(video_url, jobId);

    // Step 2: Upload clip to Firebase Storage
    console.log(`[Job ${jobId}] Step 2: Uploading clip to Firebase Storage...`);
    const destination = `clips/${jobId}.mp4`;
    const clipSignedUrl = await uploadFile(localClipPath, destination, 'video/mp4');

    // Update Firestore with clip info
    await updateDocument('analyses', jobId, {
      clip_storage_path: destination,
      clip_url: clipSignedUrl,
      status: 'analyzing',
    });

    // Step 3: Send clip to ML service for analysis
    console.log(`[Job ${jobId}] Step 3: Sending clip to ML service...`);
    const mlResult = await analyzeClip(clipSignedUrl, original_id);

    // Step 4: Save final results to Firestore
    console.log(`[Job ${jobId}] Step 4: Saving results...`);
    await updateDocument('analyses', jobId, {
      status: 'completed',
      scores: {
        visual:   mlResult.visual_score   ?? null,
        temporal: mlResult.temporal_score ?? null,
        audio:    mlResult.audio_score    ?? null,
        ocr:      mlResult.ocr_score      ?? null,
      },
      is_pirated:     mlResult.is_pirated  ?? null,
      confidence:     mlResult.confidence  ?? null,
      matched_frames: mlResult.matched_frames ?? null,
      total_frames:   mlResult.total_frames   ?? null,
      completed_at:   new Date().toISOString(),
    });

    console.log(`[Job ${jobId}] ✅ Done — is_pirated: ${mlResult.is_pirated}, confidence: ${mlResult.confidence}`);

  } catch (err) {
    console.error(`[Job ${jobId}] ❌ Failed:`, err.message);

    await updateDocument('analyses', jobId, {
      status: 'failed',
      error: err.message,
      failed_at: new Date().toISOString(),
    });

  } finally {
    // Always clean up local temp file
    cleanupTempFile(localClipPath);
  }
}

module.exports = router;