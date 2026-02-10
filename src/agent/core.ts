import { NLPEngine } from '../nlp/engine';
import { ToolRegistry } from '../tools/registry';
import { MemoryManager } from '../memory/manager';
import { IncomingMessage, ToolResult, ExecutionContext } from '../types';

export class AgentCore {
    private nlp: NLPEngine;
    private tools: ToolRegistry;
    private memory: MemoryManager;

    constructor(nlp: NLPEngine, tools: ToolRegistry, memory: MemoryManager) {
        this.nlp = nlp;
        this.tools = tools;
        this.memory = memory;
    }

    async handleMessage(message: IncomingMessage): Promise<string> {
        const { senderId, senderName, text } = message;

        // Ensure user profile exists
        const userProfile = this.memory.getOrCreateUser(senderId, senderName);
        const userId = userProfile.userId;

        console.log(`[Agent] Processing message from ${senderName} (${senderId}): "${text}"`);

        // Clean stale working memory
        if (this.memory.working.isSessionStale(userId)) {
            this.memory.working.clearSession(userId);
        }

        // Get conversation history
        const history = this.memory.getConversationHistory(userId);

        // Get relevant long-term context (RAG-lite)
        const memoryContext = this.memory.getRelevantContext(userId, text);

        // Add user message to short-term memory
        this.memory.addConversationTurn(userId, 'user', text);

        // Process through NLP engine
        const nlpResponse = await this.nlp.processMessage(
            text,
            history,
            this.tools.getAll(),
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

                // Check tool exists
                const tool = this.tools.get(toolCall.tool_name);
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
                this.memory.recordToolCall(userId, toolCall.tool_name, toolCall.parameters, {
                    success: result.success,
                    summary: result.message,
                });

                // Track frequently used contacts
                if (toolCall.parameters.to) {
                    const emails = toolCall.parameters.to.split(',').map((e: string) => e.trim());
                    for (const email of emails) {
                        this.memory.longTerm.updateFrequentContact(userId, { name: '', email, frequency: 0 });
                    }
                }
                if (toolCall.parameters.attendees) {
                    for (const email of toolCall.parameters.attendees) {
                        this.memory.longTerm.updateFrequentContact(userId, { name: '', email, frequency: 0 });
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