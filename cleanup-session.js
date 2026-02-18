const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

async function cleanup() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB_NAME || 'workspace_navigator';
    console.log(`Connecting to: ${uri.substring(0, 30)}...`);
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        // Clear corrupted signal protocol keys (pre-keys, sender-keys, sessions)
        const authResult = await db.collection('baileys_auth').deleteMany({
            key: { $regex: /^(pre-key-|sender-key-|session-|sender-key-memory-)/ }
        });
        console.log(`✅ Cleared ${authResult.deletedCount} corrupted signal keys from baileys_auth`);

        // Show remaining auth data
        const remaining = await db.collection('baileys_auth').countDocuments();
        console.log(`📊 Remaining auth documents: ${remaining} (creds + app-state)`);

        // Show sessions
        const sessions = await db.collection('sessions').find().toArray();
        console.log(`📱 Sessions:`, sessions.map(s => `${s.sessionId} (${s.status})`));

        console.log('\n✅ Cleanup done! Restart the bot with: npm run dev');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.close();
    }
}

cleanup();
