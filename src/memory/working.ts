import { WorkingMemoryState } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class WorkingMemory {
    private sessions: Map<string, WorkingMemoryState> = new Map();

    getSession(userId: string): WorkingMemoryState | null {
        return this.sessions.get(userId) || null;
    }

    createSession(userId: string, task?: string): WorkingMemoryState {
        const session: WorkingMemoryState = {
            sessionId: uuidv4(),
            userId,
            currentTask: task,
            collectedParams: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.sessions.set(userId, session);
        return session;
    }

    updateSession(userId: string, updates: Partial<WorkingMemoryState>): void {
        const session = this.sessions.get(userId);
        if (session) {
            Object.assign(session, updates, { updatedAt: new Date() });
        }
    }

    addParam(userId: string, key: string, value: any): void {
        const session = this.sessions.get(userId);
        if (session) {
            session.collectedParams[key] = value;
            session.updatedAt = new Date();
        }
    }

    clearSession(userId: string): void {
        this.sessions.delete(userId);
    }

    isSessionStale(userId: string, maxAgeMinutes: number = 30): boolean {
        const session = this.sessions.get(userId);
        if (!session) return true;
        const age = Date.now() - session.updatedAt.getTime();
        return age > maxAgeMinutes * 60 * 1000;
    }
}