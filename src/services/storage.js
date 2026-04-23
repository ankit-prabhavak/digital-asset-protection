// src/services/storage.js
const cloudinary = require('../config/cloudinary');

/**
 * Upload video to Cloudinary
 */
async function uploadFile(localPath, destination) {
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    public_id: destination.replace('.mp4', ''),
  });

  return result.secure_url; // Direct URL for ML
}

/**
 * Delete video from Cloudinary
 */
async function deleteFile(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
    });
  } catch (err) {
    console.warn('Cloudinary delete failed:', err.message);
  }
}

module.exports = { uploadFile, deleteFile };