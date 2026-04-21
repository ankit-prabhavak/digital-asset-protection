const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Generate random start time (avoids always picking intro)
 * @param {number} maxSeconds
 * @returns {number}
 */
function getRandomStartTime(maxSeconds = 300) {
  return Math.floor(Math.random() * maxSeconds); // 0–5 minutes
}

/**
 * Validate URL (basic check)
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts a 60-second clip from a video URL using FFmpeg CLI
 *
 * @param {string} inputUrl - Public video URL
 * @param {string} clipId - Unique identifier
 * @returns {Promise<string>} - Local file path
 */
function extractClip(inputUrl, clipId) {
  return new Promise((resolve, reject) => {
    if (!isValidUrl(inputUrl)) {
      return reject(new Error("Invalid video URL"));
    }

    const outputPath = path.join(os.tmpdir(), `${clipId}.mp4`);
    const startTime = getRandomStartTime();

    console.log(`\n[FFmpeg] Starting clip extraction`);
    console.log(`[FFmpeg] URL: ${inputUrl}`);
    console.log(`[FFmpeg] Start Time: ${startTime}s`);

    const command = `
      ffmpeg -y 
      -loglevel error 
      -user_agent "Mozilla/5.0"
      -ss ${startTime}
      -i "${inputUrl}"
      -t 60
      -c:v libx264
      -c:a aac
      -preset fast
      -crf 23
      -vf scale=640:-2
      -movflags +faststart
      "${outputPath}"
    `;

    const process = exec(command, { timeout: 120000 }); // 2 min timeout

    process.on("close", (code) => {
      if (code !== 0) {
        console.error(`[FFmpeg] Process exited with code ${code}`);
        return reject(new Error("FFmpeg process failed"));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error("Output file not created"));
      }

      console.log(`[FFmpeg] Clip saved at: ${outputPath}`);
      resolve(outputPath);
    });

    process.on("error", (err) => {
      console.error(`[FFmpeg] Error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Delete temporary file safely
 *
 * @param {string} filePath
 */
function cleanupTempFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Cleanup] Temp file deleted: ${filePath}`);
    }
  } catch (err) {
    console.warn(`[Cleanup] Failed to delete file: ${err.message}`);
  }
}

/**
 * Get file size in MB (for debugging/logging)
 */
function getFileSizeMB(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
  } catch {
    return null;
  }
}

module.exports = {
  extractClip,
  cleanupTempFile,
  getFileSizeMB,
};