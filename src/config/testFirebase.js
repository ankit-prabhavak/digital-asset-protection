require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { db, bucket, createDocument, getDocument } = require('./firebase');

async function testFirebase() {
  console.log('\n🔥 Testing Firebase connection...\n');

  try {
    // Test Firestore write
    await createDocument('_test', 'ping', {
      message: 'Firebase connected!',
      timestamp: new Date().toISOString(),
    });
    console.log('✅ Firestore write: OK');

    // Test Firestore read
    const doc = await getDocument('_test', 'ping');
    console.log('✅ Firestore read: OK →', doc.message);

    // Test Storage bucket access
    // console.log('✅ Storage bucket: OK →', bucket.name);

    // Cleanup test doc
    await db.collection('_test').doc('ping').delete();
    console.log('✅ Firestore cleanup: OK');

    console.log('\n🎉 Firebase is fully configured and working!\n');
  } catch (err) {
    console.error('\n❌ Firebase error:', err.message);
    console.error('\nCheck that:\n  1. serviceAccountKey.json is in the project root\n  2. FIREBASE_STORAGE_BUCKET is set correctly in .env\n  3. Firestore and Storage are enabled in Firebase console\n');
  }

  process.exit(0);
}

testFirebase();