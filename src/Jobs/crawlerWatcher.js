/**
 * crawlerWatcher.js
 *
 * Watches the local JSON file that the crawler agent writes to.
 * When new video entries appear, it automatically submits them
 * to the analyze pipeline.
 *
 * Crawler JSON format (what your agent outputs):
 * [
 *   {
 *     "title": "Kohli impersonates ABdV...",
 *     "videoId": "TU1XSUHx8Cs",
 *     "url": "https://youtube.com/watch?v=TU1XSUHx8Cs",
 *     "duration": "0:56",
 *     "views": 5960571,
 *     "ago": "5 years ago",
 *     "author": "cricket.com.au"
 *   }
 * ]
 */

const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { extractClip, cleanupTempFile, getFileSizeMB } = require('../services/ffmpeg');
const { analyzeClip, checkMLHealth } = require('../services/mlClient');
const { createDocument, updateDocument } = require('../config/firebase');
const { uploadFile, deleteFile } = require('../services/storage');

// ── State ─────────────────────────────────────────────────────────────────────

let watcherInterval = null;
const processedIds = new Set(); // videoIds already processed in this session

// ── Processed ID Management ───────────────────────────────────────────────────

/**
 * Clear in-memory processed IDs.
 * Called when a new original is uploaded so the new original
 * gets a fresh comparison run against all crawler entries.
 */
function resetProcessedIds() {
  processedIds.clear();
  console.log('[Watcher] Reset processed IDs');
}

/**
 * Load already-processed IDs from Firestore, filtered by originalId.
 * This prevents re-processing videos that were already compared
 * against the SAME original — but allows re-processing against a NEW original.
 *
 * @param {string} originalId
 */
async function loadProcessedIds(originalId) {
  try {
    const { db } = require('../config/firebase');
    const snapshot = await db.collection('analyses')
      .where('original_id', '==', originalId)
      .select('source_video_id')
      .get();

    snapshot.docs.forEach(doc => {
      const id = doc.data().source_video_id;
      if (id) processedIds.add(id);
    });

    console.log(`[Watcher] Loaded ${processedIds.size} already-processed video IDs for this original`);
  } catch (err) {
    console.warn('[Watcher] Could not load processed IDs from Firestore:', err.message);
  }
}

// ── File Reader ───────────────────────────────────────────────────────────────

/**
 * Read and parse the crawler JSON file.
 * Handles both single object and array format.
 *
 * @param {string} filePath
 * @returns {Array}
 */
function readCrawlerFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.warn(`[Watcher] Could not read crawler file: ${err.message}`);
    return [];
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Process a single crawler entry through the full pipeline:
 * crawlerEntry → FFmpeg clip → Cloudinary upload → ML analysis → Firestore result
 *
 * @param {Object} entry      - Crawler entry object
 * @param {string} originalId - Firestore ID of the reference original video
 */
async function processCrawlerEntry(entry, originalId) {
  const jobId   = uuidv4();
  const videoUrl = entry.url;
  const videoId  = entry.videoId || entry.video_id || uuidv4();

  console.log(`\n[Watcher] ── New entry detected ──`);
  console.log(`[Watcher] Title:   ${entry.title}`);
  console.log(`[Watcher] VideoId: ${videoId}`);
  console.log(`[Watcher] URL:     ${videoUrl}`);
  console.log(`[Watcher] Job ID:  ${jobId}`);

  // Save initial record to Firestore immediately (so dashboard shows it right away)
  await createDocument('analyses', jobId, {
    job_id:          jobId,
    source_video_id: videoId,
    video_url:       videoUrl,
    title:           entry.title    || '',
    author:          entry.author   || '',
    duration:        entry.duration || '',
    views:           entry.views    || 0,
    posted_ago:      entry.ago      || '',
    original_id:     originalId,
    source:          'crawler',
    status:          'processing',
    created_at:      new Date().toISOString(),
  });

  let localClipPath = null;

  try {
    // Step 1: Extract 60s clip via FFmpeg
    console.log(`[Job ${jobId}] Extracting clip...`);
    localClipPath = await extractClip(videoUrl, jobId);

    const sizeMB = getFileSizeMB(localClipPath);
    console.log(`[Job ${jobId}] Clip size: ${sizeMB} MB`);

    // Step 2: Upload clip to Cloudinary
    console.log(`[Job ${jobId}] Uploading to Cloudinary...`);
    const destination  = `clips/${jobId}`;
    const clipUrl = await uploadFile(localClipPath, destination, 'video/mp4');

    await updateDocument('analyses', jobId, {
      clip_storage_path: destination,
      clip_url:          clipUrl,
      clip_size_mb:      parseFloat(sizeMB),
      status:            'analyzing',
    });

    // Step 3: Send clip URL + original ID to ML service
    console.log(`[Job ${jobId}] Sending to ML service...`);
    const mlResult = await analyzeClip(clipUrl, originalId);

    // Step 4: Save final result to Firestore
    await updateDocument('analyses', jobId, {
      status:         'completed',
      scores: {
        visual:   mlResult.visual_score   ?? null,
        temporal: mlResult.temporal_score ?? null,
        audio:    mlResult.audio_score    ?? null,
        ocr:      mlResult.ocr_score      ?? null,
      },
      is_pirated:     mlResult.is_pirated     ?? null,
      confidence:     mlResult.confidence     ?? null,
      matched_frames: mlResult.matched_frames ?? null,
      total_frames:   mlResult.total_frames   ?? null,
      _mock:          mlResult._mock          ?? false,
      completed_at:   new Date().toISOString(),
    });

    // Step 5: Delete clip from Cloudinary (saves storage)
    console.log(`[Job ${jobId}] Deleting clip from Cloudinary...`);
    await deleteFile(destination);
    console.log(`[Job ${jobId}] Clip deleted from Cloudinary`);

    console.log(`[Job ${jobId}] ✅ Done — is_pirated: ${mlResult.is_pirated}, confidence: ${mlResult.confidence}`);

  } catch (err) {
    console.error(`[Job ${jobId}] ❌ Failed: ${err.message}`);
    await updateDocument('analyses', jobId, {
      status:    'failed',
      error:     err.message,
      failed_at: new Date().toISOString(),
    });
  } finally {
    // Always clean up local temp file
    cleanupTempFile(localClipPath);
  }
}

// ── Main Watcher ──────────────────────────────────────────────────────────────

/**
 * Start watching the crawler JSON file.
 * Automatically stops any previously running watcher instance.
 *
 * @param {string} originalId - Firestore ID of the reference original video
 */
async function startCrawlerWatcher(originalId) {
  const filePath = process.env.CRAWLER_JSON_PATH;
  const interval = parseInt(process.env.CRAWLER_POLL_INTERVAL) || 10000;

  // Stop any existing watcher before starting a new one
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log('[Watcher] Stopped previous watcher instance');
  }

  if (!filePath) {
    console.error('[Watcher] CRAWLER_JSON_PATH not set in .env — watcher disabled');
    return;
  }

  if (!originalId) {
    console.error('[Watcher] No originalId provided — watcher disabled');
    return;
  }

  console.log(`\n[Watcher] WATCHING: ${filePath}`);
  console.log(`[Watcher] Comparing against original: ${originalId}`);
  console.log(`[Watcher] Poll interval: ${interval / 1000}s\n`);

  // Load previously processed IDs for THIS original only
  await loadProcessedIds(originalId);

  // Check ML health before starting
  const mlHealth = await checkMLHealth();
  if (!mlHealth.ok) {
    console.warn(`[Watcher] ⚠️  ML service unreachable — will retry on each poll`);
  } else {
    console.log(`[Watcher] ✅ ML service reachable`);
  }

  // Start polling loop
  watcherInterval = setInterval(async () => {
    if (!fs.existsSync(filePath)) return; // crawler hasn't written yet

    const entries = readCrawlerFile(filePath);

    for (const entry of entries) {
      const videoId = entry.videoId || entry.video_id;

      if (!videoId || !entry.url) {
        console.warn('[Watcher] Skipping entry — missing videoId or url');
        continue;
      }

      // Skip if already processed in this session or in Firestore for this original
      if (processedIds.has(videoId)) continue;

      // Mark immediately to prevent double-processing on concurrent polls
      processedIds.add(videoId);

      // Check ML is up before firing the job
      const health = await checkMLHealth();
      if (!health.ok) {
        console.warn(`[Watcher] ML down — skipping ${videoId}, will retry next poll`);
        processedIds.delete(videoId); // un-mark so it retries
        continue;
      }

      // Fire pipeline in background — don't block the poll loop
      processCrawlerEntry(entry, originalId).catch(err => {
        console.error('[Watcher] Unhandled pipeline error:', err.message);
        processedIds.delete(videoId); // un-mark on failure so it can retry
      });
    }
  }, interval);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { startCrawlerWatcher, resetProcessedIds };