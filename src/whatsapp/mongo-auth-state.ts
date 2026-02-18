import { Db, Collection } from 'mongodb';
import { proto } from '@whiskeysockets/baileys';
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

interface AuthDoc {
    sessionId: string;
    key: string;
    value: any;
}

export async function useMongoDBAuthState(db: Db, sessionId: string) {
    const collection: Collection<AuthDoc> = db.collection('baileys_auth');

    // Ensure index for fast lookups
    await collection.createIndex({ sessionId: 1, key: 1 }, { unique: true });

    const writeData = async (key: string, data: any) => {
        const serialized = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await collection.updateOne(
            { sessionId, key },
            { $set: { sessionId, key, value: serialized } },
            { upsert: true }
        );
    };

    const readData = async (key: string) => {
        const doc = await collection.findOne({ sessionId, key });
        if (!doc) return null;
        return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
    };

    const removeData = async (key: string) => {
        await collection.deleteOne({ sessionId, key });
    };

    // Load or create creds
    const credsKey = 'creds';
    let creds = await readData(credsKey);
    if (!creds) {
        creds = initAuthCreds();
        await writeData(credsKey, creds);
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type: string, ids: string[]) => {
                    const result: { [id: string]: any } = {};
                    for (const id of ids) {
                        const data = await readData(`${type}-${id}`);
                        if (data) {
                            if (type === 'app-state-sync-key' && data) {
                                result[id] = proto.Message.AppStateSyncKeyData.fromObject(data);
                            } else {
                                result[id] = data;
                            }
                        }
                    }
                    return result;
                },
                set: async (data: any) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) {
                                tasks.push(writeData(`${category}-${id}`, value));
                            } else {
                                tasks.push(removeData(`${category}-${id}`));
                            }
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async () => {
            await writeData(credsKey, creds);
        },
        deleteSession: async () => {
            await collection.deleteMany({ sessionId });
        },
    };
}
