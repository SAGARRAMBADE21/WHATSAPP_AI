const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://starrboii26_db_user:SAGAR2726@cluster0.eim8ku2.mongodb.net/workspace_navigator?retryWrites=true&w=majority&appName=Cluster0';

async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log('Connected to MongoDB!\n');

        const db = client.db('workspace_navigator');
        const collection = db.collection('baileys_auth');

        // Count total docs
        const count = await collection.countDocuments();
        console.log(`Total documents in baileys_auth: ${count}\n`);

        // Get all docs
        const docs = await collection.find({}).toArray();

        for (const doc of docs) {
            console.log('─'.repeat(60));
            console.log(`  _id:       ${doc._id}`);
            console.log(`  sessionId: ${doc.sessionId}`);
            console.log(`  key:       ${doc.key}`);

            // For 'creds' key, show important fields
            if (doc.key === 'creds' && doc.value) {
                console.log(`  value:`);
                console.log(`    registrationId: ${doc.value.registrationId}`);
                console.log(`    me:             ${JSON.stringify(doc.value.me)}`);
                console.log(`    platform:       ${doc.value.platform}`);
                console.log(`    [+ other encryption keys...]`);
            } else {
                // Show value summary
                const valStr = JSON.stringify(doc.value);
                console.log(`  value:     ${valStr.substring(0, 150)}${valStr.length > 150 ? '...' : ''}`);
            }
            console.log('');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.close();
    }
}

main();
