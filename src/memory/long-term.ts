import { Db, Collection } from 'mongodb';
import { config } from '../config';
import { MemoryEntry, UserProfile, ContactInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

export class LongTermMemory {
    private db!: Db;
    private usersCol!: Collection<UserProfile>;
    private entriesCol!: Collection<MemoryEntry>;
    private initialized: boolean = false;

    constructor() {
        // DB will be set via initialize()
    }

    /**
     * Initialize with MongoDB database connection
     */
    async initialize(db: Db): Promise<void> {
        this.db = db;
        this.usersCol = db.collection<UserProfile>('memory_users');
        this.entriesCol = db.collection<MemoryEntry>('memory_entries');

        // Create indexes for fast lookups
        await this.usersCol.createIndex({ userId: 1 }, { unique: true });
        await this.usersCol.createIndex({ phoneNumber: 1 });
        await this.entriesCol.createIndex({ userId: 1, timestamp: -1 });
        await this.entriesCol.createIndex({ userId: 1, type: 1 });
        await this.entriesCol.createIndex({ tags: 1 });

        this.initialized = true;

        // Migrate existing local data if present
        await this.migrateFromLocal();

        const userCount = await this.usersCol.countDocuments();
        const entryCount = await this.entriesCol.countDocuments();
        console.log(chalk.gray(`   ▸ Long-term memory: ${userCount} users, ${entryCount} entries (MongoDB)`));
    }

    /**
     * Migrate data from old local JSON file to MongoDB (one-time)
     */
    private async migrateFromLocal(): Promise<void> {
        try {
            const localPath = config.memory.dbPath.replace('.db', '.json');
            if (!fs.existsSync(localPath)) return;

            const raw = fs.readFileSync(localPath, 'utf-8');
            const parsed = JSON.parse(raw);

            if (!parsed.users && !parsed.entries) return;

            // Check if we already migrated (by checking if any docs exist)
            const existingCount = await this.usersCol.countDocuments();
            if (existingCount > 0) {
                // Already have data in MongoDB, skip migration
                return;
            }

            console.log(chalk.cyan('   🔄 Migrating local memory to MongoDB...'));

            // Migrate users
            const users = Object.values(parsed.users || {}) as any[];
            if (users.length > 0) {
                for (const user of users) {
                    await this.usersCol.updateOne(
                        { userId: user.userId },
                        {
                            $set: {
                                ...user,
                                createdAt: new Date(user.createdAt),
                                updatedAt: new Date(user.updatedAt),
                            }
                        },
                        { upsert: true }
                    );
                }
                console.log(chalk.green(`   ✓ Migrated ${users.length} user profiles`));
            }

            // Migrate entries
            const entries = (parsed.entries || []) as any[];
            if (entries.length > 0) {
                const docs = entries.map((e: any) => ({
                    ...e,
                    timestamp: new Date(e.timestamp),
                }));
                await this.entriesCol.insertMany(docs);
                console.log(chalk.green(`   ✓ Migrated ${entries.length} memory entries`));
            }

            // Rename local file to mark as migrated
            const backupPath = localPath + '.migrated';
            fs.renameSync(localPath, backupPath);
            console.log(chalk.gray(`   ▸ Local file backed up to ${backupPath}`));

        } catch (error) {
            console.error(chalk.yellow('   ⚠ Migration from local file failed (non-critical):'), error);
        }
    }

    // ── User Profiles ──

    async getOrCreateUser(phoneNumber: string, displayName?: string): Promise<UserProfile> {
        if (!this.initialized) {
            // Fallback for uninitialized state
            return {
                userId: uuidv4(),
                phoneNumber,
                displayName,
                preferences: {},
                frequentContacts: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        }

        const existing = await this.usersCol.findOne({ phoneNumber });
        if (existing) {
            return existing;
        }

        const userId = uuidv4();
        const now = new Date();

        const user: UserProfile = {
            userId,
            phoneNumber,
            displayName,
            preferences: {},
            frequentContacts: [],
            createdAt: now,
            updatedAt: now,
        };

        await this.usersCol.insertOne(user);
        return user;
    }

    async updatePreference(userId: string, key: string, value: any): Promise<void> {
        if (!this.initialized) return;

        await this.usersCol.updateOne(
            { userId },
            {
                $set: {
                    [`preferences.${key}`]: value,
                    updatedAt: new Date(),
                }
            }
        );
    }

    async getPreferences(userId: string): Promise<Record<string, any>> {
        if (!this.initialized) return {};

        const user = await this.usersCol.findOne({ userId });
        return user?.preferences || {};
    }

    async updateFrequentContact(userId: string, contact: ContactInfo): Promise<void> {
        if (!this.initialized) return;

        const user = await this.usersCol.findOne({ userId });
        if (!user) return;

        const contacts = user.frequentContacts || [];
        const existing = contacts.find((c) => c.email === contact.email);

        if (existing) {
            existing.frequency += 1;
            existing.name = contact.name || existing.name;
        } else {
            contacts.push({ ...contact, frequency: 1 });
        }

        // Keep top 50 contacts
        contacts.sort((a, b) => b.frequency - a.frequency);
        const trimmed = contacts.slice(0, 50);

        await this.usersCol.updateOne(
            { userId },
            {
                $set: {
                    frequentContacts: trimmed,
                    updatedAt: new Date(),
                }
            }
        );
    }

    // ── Memory Entries ──

    async addEntry(entry: Omit<MemoryEntry, 'id'>): Promise<string> {
        const id = uuidv4();
        const newEntry: MemoryEntry = {
            id,
            ...entry,
        };

        if (!this.initialized) return id;

        await this.entriesCol.insertOne(newEntry);

        // Keep only the latest entries per user (prevent unlimited growth)
        const count = await this.entriesCol.countDocuments({ userId: entry.userId });
        if (count > config.memory.longTermMaxEntries) {
            // Find the oldest entries beyond the limit and delete them
            const oldest = await this.entriesCol
                .find({ userId: entry.userId })
                .sort({ timestamp: 1 })
                .limit(count - config.memory.longTermMaxEntries)
                .toArray();

            if (oldest.length > 0) {
                const idsToDelete = oldest.map(e => e.id);
                await this.entriesCol.deleteMany({ id: { $in: idsToDelete } });
            }
        }

        return id;
    }

    async searchEntries(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
        if (!this.initialized) return [];

        const lowerQuery = query.toLowerCase();
        const words = lowerQuery.split(/\s+/).filter(w => w.length > 2);

        // Search by tags first (more efficient)
        const tagResults = await this.entriesCol
            .find({
                userId,
                tags: { $in: words },
            })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        if (tagResults.length >= limit) return tagResults;

        // Fallback: search by content (text search)
        const remaining = limit - tagResults.length;
        const tagIds = tagResults.map(r => r.id);

        const contentResults = await this.entriesCol
            .find({
                userId,
                id: { $nin: tagIds },
            })
            .sort({ timestamp: -1 })
            .limit(remaining * 3) // Fetch more and filter client-side
            .toArray();

        const filtered = contentResults.filter(e =>
            JSON.stringify(e.content).toLowerCase().includes(lowerQuery)
        ).slice(0, remaining);

        return [...tagResults, ...filtered];
    }

    async getRecentEntries(userId: string, type?: string, limit: number = 20): Promise<MemoryEntry[]> {
        if (!this.initialized) return [];

        const filter: any = { userId };
        if (type) filter.type = type;

        return await this.entriesCol
            .find(filter)
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    close(): void {
        // No-op for MongoDB (connection managed by UserManager)
    }
}