const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getRandomStartTime(maxSeconds = 300) {
  return Math.floor(Math.random() * maxSeconds);
}

function isValidUrl(url) {
  try { new URL(url); return true; } catch { return false; }
}

/**
 * Detect if URL needs yt-dlp to resolve.
 * Direct .mp4 links don't need it — FFmpeg handles those directly.
 */
function needsYtDlp(url) {
  const directExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m3u8'];
  const isTelegram = url.includes('t.me') || url.includes('telegram');

  // If it's a direct video file, FFmpeg handles it
  if (directExtensions.some(ext => url.toLowerCase().includes(ext))) return false;

  // Telegram not supported by yt-dlp
  if (isTelegram) return false;

  // Everything else (YouTube, Instagram, Facebook, Twitter etc.) → use yt-dlp
  return true;
}

function isTelegramUrl(url) {
  return url.includes('t.me') || url.includes('telegram');
}

/**
 * Use yt-dlp to resolve platform URL → direct stream URL.
 * Works for YouTube, Instagram, Facebook, Twitter, Dailymotion, Vimeo, 1000+ sites.
 */
function resolveWithYtDlp(platformUrl) {
  return new Promise((resolve, reject) => {
    // -g flag prints the direct download URL without downloading
    // -f flag picks best mp4 quality available
    const command = `yt-dlp -f "best[ext=mp4]/best" -g "${platformUrl}"`;

    console.log(`[yt-dlp] Resolving URL for: ${platformUrl}`);

    exec(command, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
      }

      const directUrl = stdout.trim().split('\n')[0];
      if (!directUrl) return reject(new Error('yt-dlp returned no URL'));

      console.log(`[yt-dlp] ✅ Resolved to direct stream`);
      resolve(directUrl);
    });
  });
}

/**
 * Main clip extractor.
 * Handles:
 *   - Direct .mp4 URLs       → FFmpeg directly
 *   - YouTube                → yt-dlp → FFmpeg
 *   - Instagram / Facebook   → yt-dlp → FFmpeg
 *   - Twitter / X            → yt-dlp → FFmpeg
 *   - Telegram               → needs direct file URL from crawler
 *   - Any other platform     → yt-dlp → FFmpeg
 */
async function extractClip(inputUrl, clipId) {
  if (!isValidUrl(inputUrl)) throw new Error('Invalid video URL');

  const outputPath = path.join(os.tmpdir(), `${clipId}.mp4`);
  const startTime = getRandomStartTime();

  let finalUrl = inputUrl;

  if (isTelegramUrl(inputUrl)) {
    // Telegram URLs are not publicly accessible web URLs.
    // Your crawler teammate needs to download the file first
    // and give you a direct file URL or Firebase Storage URL.
    throw new Error(
      'Telegram URLs cannot be processed directly. ' +
      'Crawler must download the file and provide a direct .mp4 URL.'
    );
  }

  if (needsYtDlp(inputUrl)) {
    // Resolve platform URL to direct stream URL via yt-dlp
    finalUrl = await resolveWithYtDlp(inputUrl);
  }

  console.log(`[FFmpeg] Extracting clip | start: ${startTime}s`);

  return new Promise((resolve, reject) => {
    const command = [
      'ffmpeg -y',
      '-loglevel error',
      `-user_agent "Mozilla/5.0"`,
      `-ss ${startTime}`,
      `-i "${finalUrl}"`,
      '-t 60',
      '-c:v libx264',
      '-c:a aac',
      '-preset fast',
      '-crf 23',
      '-vf scale=640:-2',
      '-movflags +faststart',
      `"${outputPath}"`,
    ].join(' ');

    const child = exec(command, { timeout: 120000 });

    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg exited with code ${code}`));
      if (!fs.existsSync(outputPath)) return reject(new Error('Output file not created'));
      console.log(`[FFmpeg] ✅ Clip saved: ${outputPath}`);
      resolve(outputPath);
    });

    child.on('error', (err) => reject(err));
  });
}

function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Cleanup] Deleted: ${filePath}`);
    }
  } catch (err) {
    console.warn(`[Cleanup] Failed: ${err.message}`);
  }
}

function getFileSizeMB(filePath) {
  try {
    return (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
  } catch { return null; }
}

module.exports = { extractClip, cleanupTempFile, getFileSizeMB };