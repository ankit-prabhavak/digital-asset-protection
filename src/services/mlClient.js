require('dotenv').config();

const axios = require('axios');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const USE_MOCK = ML_URL === 'mock';

// Axios instance
const mlAxios = axios.create({
  baseURL: ML_URL,
  timeout: 300000, // 5 minutes
  headers: { 'Content-Type': 'application/json' },
});

// ── Mock responses (used when ML_SERVICE_URL=mock in .env) ───────────────────

function mockAnalyzeResponse() {
  console.log('[ML Mock] Returning mock analysis result');
  return {
    visual_score:   parseFloat((Math.random() * 0.4 + 0.6).toFixed(2)),
    temporal_score: parseFloat((Math.random() * 0.4 + 0.5).toFixed(2)),
    audio_score:    parseFloat((Math.random() * 0.4 + 0.6).toFixed(2)),
    ocr_score:      parseFloat((Math.random() * 0.5).toFixed(2)),
    is_pirated:     true,
    confidence:     parseFloat((Math.random() * 0.3 + 0.7).toFixed(2)),
    matched_frames: 42,
    total_frames:   60,
    _mock:          true,
  };
}

function mockIndexResponse(originalId) {
  console.log('[ML Mock] Returning mock index result');
  return { status: 'done', original_id: originalId, _mock: true };
}

// ── Real ML calls ─────────────────────────────────────────────────────────────

/**
 * Tells the ML service to build a FAISS index from an original video.
 * ML endpoint: POST /index
 * Request:  { original_id, video_url }
 * Response: { status: "indexing" | "done" }
 */
async function indexOriginalVideo(originalId, videoUrl) {
  if (USE_MOCK) return mockIndexResponse(originalId);

  console.log(`[ML] Sending original video for indexing: ${originalId}`);
  try {
    const response = await mlAxios.post('/index', {
      original_id: originalId,
      video_url:   videoUrl,
    });
    console.log('[ML] Indexing response:', response.data);
    return response.data;
  } catch (err) {
    throw new Error(`ML indexing failed: ${err.response?.data || err.message}`);
  }
}

/**
 * Sends a suspected pirated clip to ML for analysis.
 * ML endpoint: POST /analyze
 * Request:  { clip_url, original_id }
 * Response: { visual_score, temporal_score, audio_score, ocr_score,
 *             is_pirated, confidence, matched_frames, total_frames }
 */
async function analyzeClip(clipUrl, originalId) {
  if (USE_MOCK) return mockAnalyzeResponse();

  console.log(`[ML] Sending clip for analysis against original: ${originalId}`);
  try {
    const response = await mlAxios.post('/analyze', {
      clip_url:    clipUrl,
      original_id: originalId,
    });
    console.log('[ML] Analysis result:', response.data);
    return response.data;
  } catch (err) {
    throw new Error(`ML analysis failed: ${err.response?.data || err.message}`);
  }
}

/**
 * Health check — verify ML service is reachable before processing.
 */
async function checkMLHealth() {
  if (USE_MOCK) return { ok: true, data: { status: 'mock mode' } };

  try {
    const response = await mlAxios.get('/health', { timeout: 5000 });
    return { ok: true, data: response.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { indexOriginalVideo, analyzeClip, checkMLHealth };