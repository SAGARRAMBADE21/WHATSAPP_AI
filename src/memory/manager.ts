import { ShortTermMemory } from './short-term';
import { WorkingMemory } from './working';
import { LongTermMemory } from './long-term';
import { ConversationTurn, UserProfile, MemoryEntry } from '../types';

export class MemoryManager {
    public shortTerm: ShortTermMemory;
    public working: WorkingMemory;
    public longTerm: LongTermMemory;

    constructor() {
        this.shortTerm = new ShortTermMemory();
        this.working = new WorkingMemory();
        this.longTerm = new LongTermMemory();
    }

    getOrCreateUser(phoneNumber: string, displayName?: string): UserProfile {
        return this.longTerm.getOrCreateUser(phoneNumber, displayName);
    }

    addConversationTurn(userId: string, role: 'user' | 'assistant', content: string): void {
        this.shortTerm.addTurn(userId, {
            role,
            content,
            timestamp: new Date(),
        });
    }

    getConversationHistory(userId: string): ConversationTurn[] {
        return this.shortTerm.getHistory(userId);
    }

    recordToolCall(userId: string, toolName: string, params: Record<string, any>, result: any): void {
        this.longTerm.addEntry({
            userId,
            type: 'tool_call',
            content: { tool: toolName, parameters: params, result },
            tags: [toolName, ...Object.keys(params)],
            timestamp: new Date(),
        });
    }

    getRelevantContext(userId: string, query: string): string {
        const prefs = this.longTerm.getPreferences(userId);
        const recentCalls = this.longTerm.getRecentEntries(userId, 'tool_call', 5);
        const searchResults = this.longTerm.searchEntries(userId, query, 3);

        let context = '';

        if (Object.keys(prefs).length > 0) {
            context += `\n<user_preferences>\n${JSON.stringify(prefs, null, 2)}\n</user_preferences>\n`;
        }

        if (recentCalls.length > 0) {
            const summaries = recentCalls.map(
                (e) => `- ${e.content.tool}(${JSON.stringify(e.content.parameters)}) at ${e.timestamp.toISOString()}`
            );
            context += `\n<recent_actions>\n${summaries.join('\n')}\n</recent_actions>\n`;
        }

        if (searchResults.length > 0) {
            const relevant = searchResults.map((e) => `- [${e.type}] ${JSON.stringify(e.content)}`);
            context += `\n<relevant_history>\n${relevant.join('\n')}\n</relevant_history>\n`;
        }

        return context;
    }

    shutdown(): void {
        this.longTerm.close();
    }
}