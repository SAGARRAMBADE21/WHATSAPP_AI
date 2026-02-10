import { ConversationTurn } from '../types';
import { config } from '../config';

export class ShortTermMemory {
    private conversations: Map<string, ConversationTurn[]> = new Map();

    addTurn(userId: string, turn: ConversationTurn): void {
        if (!this.conversations.has(userId)) {
            this.conversations.set(userId, []);
        }

        const history = this.conversations.get(userId)!;
        history.push(turn);

        // Keep only the last N turns
        if (history.length > config.memory.shortTermMaxTurns * 2) {
            this.conversations.set(
                userId,
                history.slice(-config.memory.shortTermMaxTurns * 2)
            );
        }
    }

    getHistory(userId: string, maxTurns?: number): ConversationTurn[] {
        const history = this.conversations.get(userId) || [];
        const limit = maxTurns || config.memory.shortTermMaxTurns;
        return history.slice(-limit * 2); // Each turn has user + assistant
    }

    clear(userId: string): void {
        this.conversations.delete(userId);
    }

    clearAll(): void {
        this.conversations.clear();
    }
}