const axios = require('axios');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Axios instance with timeout config
const mlAxios = axios.create({
  baseURL: ML_URL,
  timeout: 180000, // 3 minutes — ML processing takes time
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Tells the ML service to build a FAISS index from an original video.
 * Called once per original video upload.
 *
 * ML teammate's endpoint: POST /index
 * Request:  { original_id, video_url }
 * Response: { status: "indexing" | "done", message }
 */
async function indexOriginalVideo(originalId, videoUrl) {
  console.log(`[ML] Sending original video for indexing: ${originalId}`);

  const response = await mlAxios.post('/index', {
    original_id: originalId,
    video_url: videoUrl,
  });

  console.log(`[ML] Indexing response:`, response.data);
  return response.data;
}

/**
 * Sends a suspected pirated clip to ML for analysis.
 * ML compares the clip against the stored FAISS index.
 *
 * ML teammate's endpoint: POST /analyze
 * Request:  { clip_url, original_id }
 * Response: {
 *   visual_score:   0.87,   // frame-level CLIP similarity
 *   temporal_score: 0.74,   // sliding window scene similarity
 *   audio_score:    0.91,   // MFCC audio similarity
 *   ocr_score:      0.33,   // fraction of frames with piracy keywords
 *   is_pirated:     true,
 *   confidence:     0.82,
 *   matched_frames: 42,
 *   total_frames:   60
 * }
 */
async function analyzeClip(clipUrl, originalId) {
  console.log(`[ML] Sending clip for analysis against original: ${originalId}`);

  const response = await mlAxios.post('/analyze', {
    clip_url: clipUrl,
    original_id: originalId,
  });

  console.log(`[ML] Analysis result:`, response.data);
  return response.data;
}

/**
 * Health check — verify ML service is reachable before processing.
 */
async function checkMLHealth() {
  try {
    const response = await mlAxios.get('/health', { timeout: 5000 });
    return { ok: true, data: response.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { indexOriginalVideo, analyzeClip, checkMLHealth };