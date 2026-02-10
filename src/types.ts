// ─── Core Types ──────────────────────────────────────────────

export interface ToolCall {
    tool_name: string;
    parameters: Record<string, any>;
}

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    message: string;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: JSONSchema;
    execute: (params: Record<string, any>, context: ExecutionContext) => Promise<ToolResult>;
}

export interface JSONSchema {
    type: string;
    properties: Record<string, any>;
    required?: string[];
}

export interface ExecutionContext {
    userId: string;
    conversationId: string;
    timestamp: Date;
}

// ─── NLP Types ───────────────────────────────────────────────

export interface NLPResponse {
    type: 'tool_call' | 'clarification' | 'rejection' | 'text_response';
    toolCall?: ToolCall;
    message?: string;
}

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

// ─── Memory Types ────────────────────────────────────────────

export interface UserProfile {
    userId: string;
    phoneNumber: string;
    displayName?: string;
    preferences: Record<string, any>;
    frequentContacts: ContactInfo[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ContactInfo {
    name: string;
    email: string;
    frequency: number;
}

export interface WorkingMemoryState {
    sessionId: string;
    userId: string;
    currentTask?: string;
    collectedParams: Record<string, any>;
    pendingTool?: string;
    missingFields?: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface MemoryEntry {
    id: string;
    userId: string;
    type: 'tool_call' | 'preference' | 'contact' | 'note';
    content: Record<string, any>;
    tags: string[];
    timestamp: Date;
}

// ─── Google API Types ────────────────────────────────────────

export interface GoogleTokens {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    token_type: string;
    scope: string;
}

// ─── WhatsApp Types ──────────────────────────────────────────

export interface IncomingMessage {
    senderId: string;
    senderName: string;
    text: string;
    timestamp: Date;
    isGroup: boolean;
    groupId?: string;
    messageId: string;
}