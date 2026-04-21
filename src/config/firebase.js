const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK (only once)
if (!admin.apps.length) {
  const serviceAccount = require(path.join(__dirname, '../../serviceAccountKey.json'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ─── Firestore Helpers ───────────────────────────────────────────────────────

async function createDocument(collection, docId, data) {
  await db.collection(collection).doc(docId).set(data);
}

async function updateDocument(collection, docId, data) {
  await db.collection(collection).doc(docId).update(data);
}

async function getDocument(collection, docId) {
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists) return null;
  return doc.data();
}

async function listDocuments(collection, options = {}) {
  let query = db.collection(collection);

  if (options.orderBy) {
    query = query.orderBy(options.orderBy, options.orderDir || 'desc');
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.where) {
    const { field, op, value } = options.where;
    query = query.where(field, op, value);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => doc.data());
}

// ─── Storage Helpers ─────────────────────────────────────────────────────────

async function uploadFile(localPath, destination, contentType = 'video/mp4') {
  await bucket.upload(localPath, {
    destination,
    metadata: { contentType },
  });

  // Generate signed URL valid for 2 hours (so ML can download the clip)
  const [signedUrl] = await bucket.file(destination).getSignedUrl({
    action: 'read',
    expires: Date.now() + 2 * 60 * 60 * 1000,
  });

  return signedUrl;
}

async function deleteFile(destination) {
  try {
    await bucket.file(destination).delete();
  } catch (err) {
    console.warn(`Could not delete file ${destination}:`, err.message);
  }
}

module.exports = {
  db,
  bucket,
  createDocument,
  updateDocument,
  getDocument,
  listDocuments,
  uploadFile,
  deleteFile,
};