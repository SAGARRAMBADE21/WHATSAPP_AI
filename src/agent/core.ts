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
        // Check if we already have tools loaded for this user
        if (this.userToolRegistries.has(phoneNumber)) {
            return this.userToolRegistries.get(phoneNumber)!;
        }

        // Get user's authenticated Google client
        const authClient = await this.userManager.getUserAuthClient(phoneNumber);
        if (!authClient) {
            return null;
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

        [...gmailTools, ...calendarTools, ...driveTools, ...sheetsTools, ...docsTools, ...classroomTools].forEach((tool) =>
            userTools.register(tool)
        );

        // Cache for future use
        this.userToolRegistries.set(phoneNumber, userTools);

        return userTools;
    }

    async handleMessage(message: IncomingMessage, phoneNumber: string): Promise<string> {
        const { senderId, senderName, text } = message;

        // Check if user is registered
        const isRegistered = await this.userManager.isUserRegistered(phoneNumber);
        if (!isRegistered) {
            return '⚠️ You need to register first!\n\n' +
                '📝 Send /register to connect your Google Workspace\n' +
                '🔐 You will get a secure link to authorize access';
        }

        // Get user-specific tool registry
        const userTools = await this.getUserToolRegistry(phoneNumber);
        if (!userTools) {
            return '❌ Failed to load your workspace tools. Please try /logout and re-register.';
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