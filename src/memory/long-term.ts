import { config } from '../config';
import { MemoryEntry, UserProfile, ContactInfo } from '../types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

interface StorageData {
    users: Record<string, UserProfile>;
    entries: MemoryEntry[];
}

export class LongTermMemory {
    private dataPath: string;
    private data: StorageData = { users: {}, entries: [] };

    constructor() {
        const dir = path.dirname(config.memory.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.dataPath = config.memory.dbPath.replace('.db', '.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.dataPath)) {
                const raw = fs.readFileSync(this.dataPath, 'utf-8');
                const parsed = JSON.parse(raw);
                // Deserialize dates
                this.data = {
                    users: Object.fromEntries(
                        Object.entries(parsed.users || {}).map(([k, v]: [string, any]) => [
                            k,
                            {
                                ...v,
                                createdAt: new Date(v.createdAt),
                                updatedAt: new Date(v.updatedAt),
                            },
                        ])
                    ),
                    entries: (parsed.entries || []).map((e: any) => ({
                        ...e,
                        timestamp: new Date(e.timestamp),
                    })),
                };
            } else {
                this.data = { users: {}, entries: [] };
            }
        } catch (error) {
            console.error('[LongTermMemory] Failed to load data:', error);
            this.data = { users: {}, entries: [] };
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('[LongTermMemory] Failed to save data:', error);
        }
    }

    // ── User Profiles ──

    getOrCreateUser(phoneNumber: string, displayName?: string): UserProfile {
        const existing = Object.values(this.data.users).find((u) => u.phoneNumber === phoneNumber);

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

        this.data.users[userId] = user;
        this.save();

        return user;
    }

    updatePreference(userId: string, key: string, value: any): void {
        const user = this.data.users[userId];
        if (user) {
            user.preferences[key] = value;
            user.updatedAt = new Date();
            this.save();
        }
    }

    getPreferences(userId: string): Record<string, any> {
        return this.data.users[userId]?.preferences || {};
    }

    updateFrequentContact(userId: string, contact: ContactInfo): void {
        const user = this.data.users[userId];
        if (user) {
            const existing = user.frequentContacts.find((c) => c.email === contact.email);
            if (existing) {
                existing.frequency += 1;
                existing.name = contact.name || existing.name;
            } else {
                user.frequentContacts.push({ ...contact, frequency: 1 });
            }
            // Keep top 50 contacts
            user.frequentContacts.sort((a, b) => b.frequency - a.frequency);
            user.frequentContacts = user.frequentContacts.slice(0, 50);
            user.updatedAt = new Date();
            this.save();
        }
    }

    // ── Memory Entries ──

    addEntry(entry: Omit<MemoryEntry, 'id'>): string {
        const id = uuidv4();
        const newEntry: MemoryEntry = {
            id,
            ...entry,
        };
        this.data.entries.push(newEntry);

        // Keep only the latest entries (prevent unlimited growth)
        if (this.data.entries.length > config.memory.longTermMaxEntries) {
            this.data.entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            this.data.entries = this.data.entries.slice(0, config.memory.longTermMaxEntries);
        }

        this.save();
        return id;
    }

    searchEntries(userId: string, query: string, limit: number = 10): MemoryEntry[] {
        const lowerQuery = query.toLowerCase();
        return this.data.entries
            .filter(
                (e) =>
                    e.userId === userId &&
                    (JSON.stringify(e.content).toLowerCase().includes(lowerQuery) ||
                        e.tags.some((t) => t.toLowerCase().includes(lowerQuery)))
            )
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }

    getRecentEntries(userId: string, type?: string, limit: number = 20): MemoryEntry[] {
        return this.data.entries
            .filter((e) => e.userId === userId && (!type || e.type === type))
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }

    close(): void {
        this.save();
    }
}