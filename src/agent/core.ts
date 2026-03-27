import { NLPEngine } from '../nlp/engine';
import { ToolRegistry } from '../tools/registry';
import { MemoryManager } from '../memory/manager';
import { UserManager } from '../auth/user-manager';
import { IncomingMessage, ToolResult, ExecutionContext } from '../types';
import { createGmailTools } from '../tools/gmail';
import { createCalendarTools } from '../tools/calendar';
import { createDriveTools } from '../tools/drive';
import { createSheetsTools } from '../tools/sheets';
import { createDocsTools } from '../tools/docs';
import { createClassroomTools } from '../tools/classroom';
import { manusTools, handleManusToolCall } from '../tools/manus';
import { v0Tools, handleV0ToolCall } from '../tools/v0';

export class AgentCore {
    private nlp: NLPEngine;
    private tools: ToolRegistry;
    private memory: MemoryManager;
    private userManager: UserManager;
    private userToolRegistries: Map<string, ToolRegistry> = new Map();

    constructor(nlp: NLPEngine, tools: ToolRegistry, memory: MemoryManager, userManager: UserManager) {
        this.nlp = nlp;
        this.tools = tools;
        this.memory = memory;
        this.userManager = userManager;
    }

    /**
     * Get or create tool registry for a specific user with their authenticated Google client
     */
    private async getUserToolRegistry(phoneNumber: string): Promise<ToolRegistry | null> {
        // Get user's authenticated Google client
        const authClient = await this.userManager.getUserAuthClient(phoneNumber);
        if (!authClient) {
            // Auth failed — clear any stale cached tool registry for this user
            this.userToolRegistries.delete(phoneNumber);
            return null;
        }

        // Check if we already have tools loaded for this user
        if (this.userToolRegistries.has(phoneNumber)) {
            return this.userToolRegistries.get(phoneNumber)!;
        }

        // Create new tool registry for this user
        const userTools = new ToolRegistry();

        // Load all tools with user's auth client
        const gmailTools = createGmailTools(authClient);
        const calendarTools = createCalendarTools(authClient);
        const driveTools = createDriveTools(authClient);
        const sheetsTools = createSheetsTools(authClient);
        const docsTools = createDocsTools(authClient);
        const classroomTools = createClassroomTools(authClient);

        // Register Google Workspace Tools
        [...gmailTools, ...calendarTools, ...driveTools, ...sheetsTools, ...docsTools, ...classroomTools].forEach((tool) =>
            userTools.register(tool)
        );

        // Fetch user-specific encrypted API keys from MongoDB (keyed by email)
        const userDoc = await this.userManager.getUserByPhone(phoneNumber);
        const apiKeys = userDoc?.email
            ? await this.userManager.getApiKeys(userDoc.email)
            : { manusKey: undefined, v0Key: undefined };

        // Register Global API Tools (Manus & V0)
        manusTools.forEach(def => {
            userTools.register({
                name: def.function.name,
                description: def.function.description,
                parameters: def.function.parameters,
                execute: async (args: any, context: ExecutionContext) => {
                    const result = await handleManusToolCall({ function: { name: def.function.name, arguments: JSON.stringify(args) } }, apiKeys.manusKey);
                    return { success: true, message: result };
                }
            });
        });

        v0Tools.forEach(def => {
            userTools.register({
                name: def.function.name,
                description: def.function.description,
                parameters: def.function.parameters,
                execute: async (args: any, context: ExecutionContext) => {
                    const result = await handleV0ToolCall({ function: { name: def.function.name, arguments: JSON.stringify(args) } }, apiKeys.v0Key);
                    return { success: true, message: result };
                }
            });
        });

        // Cache for future use
        this.userToolRegistries.set(phoneNumber, userTools);

        return userTools;
    }

    async handleMessage(message: IncomingMessage, phoneNumber: string): Promise<string> {
        const { senderId, senderName, text } = message;

        // Get user-specific tool registry (loads per-user Google OAuth tokens)
        let userTools: ToolRegistry | null = null;
        const isRegistered = await this.userManager.isUserRegistered(phoneNumber);
        if (isRegistered) {
            userTools = await this.getUserToolRegistry(phoneNumber);
        }

        if (!userTools) {
            // User hasn't completed Google OAuth yet — direct them to the web dashboard
            return '🔐 *Google Workspace Not Connected*\n\n' +
                'To use Gmail, Calendar, Drive, Sheets & Docs:\n' +
                '1. Open *http://localhost:3000* in your browser\n' +
                '2. Sign in with Google\n' +
                '3. Scan the QR code on the dashboard\n\n' +
                'Your WhatsApp will be automatically linked!';
        }

        // Ensure user profile exists
        const userProfile = await this.memory.getOrCreateUser(senderId, senderName);
        const userId = userProfile.userId;

        console.log(`[Agent] Processing message from ${senderName} (${senderId}): "${text}"`);

        // Clean stale working memory
        if (this.memory.working.isSessionStale(userId)) {
            this.memory.working.clearSession(userId);
        }

        // Get conversation history
        const history = this.memory.getConversationHistory(userId);

        // Get relevant long-term context (RAG-lite)
        const memoryContext = await this.memory.getRelevantContext(userId, text);

        // Add user message to short-term memory
        this.memory.addConversationTurn(userId, 'user', text);

        // Process through NLP engine with user-specific tools
        const nlpResponse = await this.nlp.processMessage(
            text,
            history,
            userTools.getAll(),
            memoryContext
        );

        let responseText: string;

        switch (nlpResponse.type) {
            case 'tool_call': {
                const { toolCall } = nlpResponse;
                if (!toolCall) {
                    responseText = 'I understood your request but could not determine the right action. Could you rephrase?';
                    break;
                }

                // Check tool exists in user's registry
                const tool = userTools.get(toolCall.tool_name);
                if (!tool) {
                    responseText = `I tried to use the tool "${toolCall.tool_name}" but it doesn't exist. Please try rephrasing your request.`;
                    break;
                }

                console.log(`[Agent] Executing tool: ${toolCall.tool_name}`, JSON.stringify(toolCall.parameters));

                // Execute the tool
                const context: ExecutionContext = {
                    userId,
                    conversationId: senderId,
                    timestamp: new Date(),
                };

                let result: ToolResult;
                try {
                    result = await tool.execute(toolCall.parameters, context);
                } catch (error: any) {
                    result = {
                        success: false,
                        error: error.message,
                        message: `An unexpected error occurred while executing ${toolCall.tool_name}: ${error.message}`,
                    };
                }

                // Record tool call in long-term memory
                await this.memory.recordToolCall(userId, toolCall.tool_name, toolCall.parameters, {
                    success: result.success,
                    summary: result.message,
                });

                // Track frequently used contacts
                if (toolCall.parameters.to) {
                    const emails = toolCall.parameters.to.split(',').map((e: string) => e.trim());
                    for (const email of emails) {
                        await this.memory.longTerm.updateFrequentContact(userId, { name: '', email, frequency: 0 });
                    }
                }
                if (toolCall.parameters.attendees) {
                    for (const email of toolCall.parameters.attendees) {
                        await this.memory.longTerm.updateFrequentContact(userId, { name: '', email, frequency: 0 });
                    }
                }

                responseText = result.message;

                // If NLP also included a text message alongside the tool call
                if (nlpResponse.message) {
                    responseText = `${nlpResponse.message}\n\n${responseText}`;
                }

                break;
            }

            case 'clarification':
                responseText = nlpResponse.message || 'Could you provide more details about what you need?';
                break;

            case 'rejection':
                responseText = nlpResponse.message || "I'm not able to help with that. I can manage your Gmail, Calendar, Drive, and Sheets. What would you like to do?";
                break;

            case 'text_response':
            default:
                responseText = nlpResponse.message || "I'm here to help manage your Google Workspace. What would you like to do?";
                break;
        }

        // Add assistant response to short-term memory
        this.memory.addConversationTurn(userId, 'assistant', responseText);

        return responseText;
    }
}