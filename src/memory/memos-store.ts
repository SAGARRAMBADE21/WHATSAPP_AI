import { Db, Collection } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

export type MemOSTier = 'episodic' | 'semantic' | 'procedural';
export type MemOSSourceTool =
    | 'gmail' | 'calendar' | 'drive' | 'sheets' | 'docs' | 'classroom'
    | 'manus' | 'v0' | 'whatsapp' | 'orchestrator';
export type MemOSImportance = 'high' | 'medium' | 'low';

export interface MemOSEntry {
    id: string;
    userEmail: string;         // per-user isolation keyed by email (from JWT)
    tier: MemOSTier;
    source_tool: MemOSSourceTool;
    content: string;
    subject?: string;          // semantic: what this is about
    workflow_name?: string;    // procedural: name of the workflow
    tags: string[];
    importance: MemOSImportance;
    session_id?: string;
    created_at: Date;
    valid_until: Date | null;  // null = permanent; Date = expiry (episodic)
    related_to: string[];      // IDs of explicitly related memories (graph edges)
}

export interface MemOSGraphData {
    nodes: Array<{
        id: string;
        label: string;
        tier: MemOSTier;
        source_tool: MemOSSourceTool;
        importance: MemOSImportance;
        content: string;
        subject?: string;
        workflow_name?: string;
        created_at: string;
        tags: string[];
        expired: boolean;
    }>;
    edges: Array<{
        source: string;
        target: string;
        type: 'explicit' | 'tag';
        label?: string;
    }>;
    stats: Record<string, number>;
}

export class MemOSStore {
    private col!: Collection<MemOSEntry>;
    private initialized = false;

    async initialize(db: Db): Promise<void> {
        this.col = db.collection<MemOSEntry>('memos_entries');

        await Promise.all([
            this.col.createIndex({ userEmail: 1, created_at: -1 }),
            this.col.createIndex({ userEmail: 1, tier: 1 }),
            this.col.createIndex({ userEmail: 1, source_tool: 1 }),
            this.col.createIndex({ tags: 1 }),
            this.col.createIndex({ id: 1 }, { unique: true }),
        ]);

        this.initialized = true;
        const count = await this.col.countDocuments();
        console.log(chalk.gray(`   ▸ MemOS store: ${count} entries`));
    }

    // ── Write ──────────────────────────────────────────────────────────────────

    async storeEpisodic(
        userEmail: string,
        content: string,
        source_tool: MemOSSourceTool,
        opts: {
            tags?: string[];
            importance?: MemOSImportance;
            session_id?: string;
            related_to?: string[];
            ttl_days?: number;
        } = {}
    ): Promise<string> {
        const ttlMs = (opts.ttl_days ?? 30) * 24 * 60 * 60 * 1000;
        return this._insert({
            userEmail, tier: 'episodic', source_tool, content,
            tags: opts.tags ?? [],
            importance: opts.importance ?? 'medium',
            session_id: opts.session_id,
            valid_until: new Date(Date.now() + ttlMs),
            related_to: opts.related_to ?? [],
        });
    }

    async storeSemantic(
        userEmail: string,
        content: string,
        subject: string,
        source_tool: MemOSSourceTool,
        opts: {
            tags?: string[];
            importance?: MemOSImportance;
            related_to?: string[];
        } = {}
    ): Promise<string> {
        return this._insert({
            userEmail, tier: 'semantic', source_tool, content, subject,
            tags: opts.tags ?? [],
            importance: opts.importance ?? 'medium',
            valid_until: null,
            related_to: opts.related_to ?? [],
        });
    }

    async storeProcedural(
        userEmail: string,
        workflow_name: string,
        content: string,
        source_tool: MemOSSourceTool,
        opts: {
            tags?: string[];
            importance?: MemOSImportance;
            related_to?: string[];
        } = {}
    ): Promise<string> {
        return this._insert({
            userEmail, tier: 'procedural', source_tool, content, workflow_name,
            tags: opts.tags ?? [],
            importance: opts.importance ?? 'high',
            valid_until: null,
            related_to: opts.related_to ?? [],
        });
    }

    private async _insert(entry: Omit<MemOSEntry, 'id' | 'created_at'>): Promise<string> {
        if (!this.initialized) throw new Error('MemOSStore not initialized');
        const id = uuidv4();
        await this.col.insertOne({ ...entry, id, created_at: new Date() } as MemOSEntry);
        return id;
    }

    // ── Read ───────────────────────────────────────────────────────────────────

    async retrieve(
        userEmail: string,
        query: string,
        opts: { tier?: MemOSTier; source_tool?: MemOSSourceTool; limit?: number } = {}
    ): Promise<MemOSEntry[]> {
        if (!this.initialized) return [];

        const filter: any = { userEmail };
        if (opts.tier) filter.tier = opts.tier;
        if (opts.source_tool) filter.source_tool = opts.source_tool;

        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
            filter.$or = [
                { tags: { $in: words } },
                { content: { $regex: words.join('|'), $options: 'i' } },
                { subject: { $regex: words.join('|'), $options: 'i' } },
                { workflow_name: { $regex: words.join('|'), $options: 'i' } },
            ];
        }

        return this.col.find(filter).sort({ created_at: -1 }).limit(opts.limit ?? 10).toArray();
    }

    async list(
        userEmail: string,
        opts: { tier?: MemOSTier; source_tool?: MemOSSourceTool; limit?: number; offset?: number } = {}
    ): Promise<{ entries: MemOSEntry[]; total: number }> {
        if (!this.initialized) return { entries: [], total: 0 };

        const filter: any = { userEmail };
        if (opts.tier) filter.tier = opts.tier;
        if (opts.source_tool) filter.source_tool = opts.source_tool;

        const limit = opts.limit ?? 50;
        const offset = opts.offset ?? 0;

        const [entries, total] = await Promise.all([
            this.col.find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
            this.col.countDocuments(filter),
        ]);

        return { entries, total };
    }

    async delete(userEmail: string, id: string): Promise<boolean> {
        if (!this.initialized) return false;
        const result = await this.col.deleteOne({ id, userEmail });
        return result.deletedCount > 0;
    }

    async stats(userEmail: string): Promise<Record<string, number>> {
        if (!this.initialized) return {};
        const [total, episodic, semantic, procedural] = await Promise.all([
            this.col.countDocuments({ userEmail }),
            this.col.countDocuments({ userEmail, tier: 'episodic' }),
            this.col.countDocuments({ userEmail, tier: 'semantic' }),
            this.col.countDocuments({ userEmail, tier: 'procedural' }),
        ]);
        return { total, episodic, semantic, procedural };
    }

    // ── Graph ──────────────────────────────────────────────────────────────────

    async getGraphData(userEmail: string): Promise<MemOSGraphData> {
        if (!this.initialized) return { nodes: [], edges: [], stats: {} };

        const entries = await this.col
            .find({ userEmail })
            .sort({ created_at: -1 })
            .limit(300)
            .toArray();

        const now = new Date();
        const entryIds = new Set(entries.map(e => e.id));

        const nodes = entries.map(e => ({
            id: e.id,
            label: (e.subject ?? e.workflow_name ?? e.content).slice(0, 50),
            tier: e.tier,
            source_tool: e.source_tool,
            importance: e.importance,
            content: e.content,
            subject: e.subject,
            workflow_name: e.workflow_name,
            created_at: e.created_at.toISOString(),
            tags: e.tags,
            expired: e.valid_until !== null && e.valid_until < now,
        }));

        const edges: MemOSGraphData['edges'] = [];
        const seen = new Set<string>();

        // Explicit edges (related_to)
        for (const e of entries) {
            for (const relId of e.related_to) {
                if (!entryIds.has(relId)) continue;
                const key = [e.id, relId].sort().join('||');
                if (!seen.has(key)) {
                    seen.add(key);
                    edges.push({ source: e.id, target: relId, type: 'explicit' });
                }
            }
        }

        // Tag-based edges (shared tags between nodes)
        const tagMap = new Map<string, string[]>();
        for (const e of entries) {
            for (const tag of e.tags) {
                if (!tagMap.has(tag)) tagMap.set(tag, []);
                tagMap.get(tag)!.push(e.id);
            }
        }
        for (const [tag, ids] of tagMap) {
            if (ids.length < 2) continue;
            for (let i = 0; i < Math.min(ids.length, 10); i++) {
                for (let j = i + 1; j < Math.min(ids.length, 10); j++) {
                    const key = [ids[i], ids[j]].sort().join('||');
                    if (!seen.has(key)) {
                        seen.add(key);
                        edges.push({ source: ids[i], target: ids[j], type: 'tag', label: tag });
                    }
                }
            }
        }

        const statsRaw = await this.stats(userEmail);
        return { nodes, edges, stats: statsRaw };
    }
}
