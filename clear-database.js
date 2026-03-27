const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();

async function clearDatabase() {
    // Use direct connection string to bypass SRV lookup issues
    const uri = 'mongodb://starrboii26_db_user:SAGAR2726@ac-lzuooad-shard-00-00.eim8ku2.mongodb.net:27017,ac-lzuooad-shard-00-01.eim8ku2.mongodb.net:27017,ac-lzuooad-shard-00-02.eim8ku2.mongodb.net:27017/workspace_navigator?tls=true&authSource=admin&retryWrites=true&w=majority';
    const dbName = process.env.MONGODB_DB_NAME || 'workspace_navigator';
    
    console.log(`\n🗑️  CLEARING DATABASE: ${dbName}`);
    console.log(`   Connecting...`);
    
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        // Get all collections
        const collections = await db.listCollections().toArray();
        console.log(`\n📋 Found ${collections.length} collections:\n`);

        let totalDeleted = 0;

        for (const col of collections) {
            const collection = db.collection(col.name);
            const count = await collection.countDocuments();
            const result = await collection.deleteMany({});
            totalDeleted += result.deletedCount;
            console.log(`   ✅ ${col.name}: deleted ${result.deletedCount} documents (was ${count})`);
        }

        console.log(`\n🧹 Total documents deleted: ${totalDeleted}`);
        console.log(`✅ Database "${dbName}" has been cleared!\n`);
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.close();
    }
}

clearDatabase();
