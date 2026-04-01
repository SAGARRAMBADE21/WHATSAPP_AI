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
import { createSandboxTools } from '../tools/sandbox';
import { createV0SandboxTool } from '../tools/v0-sandbox';
import { E2BSandboxManager } from '../sandbox/e2b-manager';

export class AgentCore {
    private nlp: NLPEngine;
    private tools: ToolRegistry;
    private memory: MemoryManager;
    private userManager: UserManager;
    private sandboxManager?: E2BSandboxManager;
    private userToolRegistries: Map<string, ToolRegistry> = new Map();

    constructor(nlp: NLPEngine, tools: ToolRegistry, memory: MemoryManager, userManager: UserManager, sandboxManager?: E2BSandboxManager) {
        this.nlp = nlp;
        this.tools = tools;
        this.memory = memory;
        this.userManager = userManager;
        this.sandboxManager = sandboxManager;
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

        // Register sandbox tools when sandbox manager is available.
        if (this.sandboxManager) {
            const sandboxTools = createSandboxTools(this.sandboxManager);
            sandboxTools.forEach((tool) => userTools.register(tool));

            // Combined v0 → sandbox tool (fetches v0 files + writes + runs in one shot)
            const v0SandboxTool = createV0SandboxTool(this.sandboxManager, apiKeys.v0Key);
            userTools.register(v0SandboxTool);
        }

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
                '1. Open *http://43.205.202.70:3000* in your browser\n' +
                '2. Sign in with Google\n' +
                '3. Scan the QR code on the dashboard\n\n' +
                'Your WhatsApp will be automatically linked!';
        }

        // Ensure user profile exists
        const userProfile = await this.memory.getOrCreateUser(senderId, senderName);
        const userId = userProfile.userId;

        // Resolve the user's email so sandbox sessions are keyed consistently
        // (web dashboard also keys by email — this keeps them in sync)
        const userDoc = await this.userManager.getUserByPhone(phoneNumber);
        const sandboxUserId = userDoc?.email || phoneNumber;

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

        // Deterministic fast-path: execute direct E2B command requests without relying on model interpretation.
        const directSandboxCommand = this._extractDirectSandboxCommand(text);
        if (directSandboxCommand) {
            const sandboxTool = userTools.get('sandbox_run_command');
            if (sandboxTool) {
                const context: ExecutionContext = {
                    userId: sandboxUserId,
                    conversationId: senderId,
                    timestamp: new Date(),
                };
                try {
                    const result = await sandboxTool.execute({ command: directSandboxCommand }, context);
                    await this.memory.recordToolCall(userId, 'sandbox_run_command', { command: directSandboxCommand }, {
                        success: result.success,
                        summary: result.message,
                    });
                    if (userDoc?.email) {
                        await this.memory.memosStore.storeEpisodic(
                            userDoc.email,
                            `sandbox_run_command: ${result.message?.slice(0, 200) || 'executed'}`,
                            'orchestrator',
                            { tags: ['sandbox_run_command'], importance: 'medium' }
                        );
                    }
                    const response = result.message || 'Command executed.';
                    this.memory.addConversationTurn(userId, 'assistant', response);
                    return response;
                } catch (error: any) {
                    const response = `Sandbox command execution failed: ${error.message || String(error)}`;
                    this.memory.addConversationTurn(userId, 'assistant', response);
                    return response;
                }
            } else {
                // Sandbox tool not registered — E2B_API_KEY may be missing
                const response = '⚠️ *E2B Sandbox Not Available*\n\nThe sandbox is not configured on this server.\n\nPlease set `E2B_API_KEY` in the `.env` file and restart to enable sandbox execution.';
                this.memory.addConversationTurn(userId, 'assistant', response);
                return response;
            }
        }

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

                // Execute the tool (sandbox tools need email-based userId for session consistency)
                const context: ExecutionContext = {
                    userId: sandboxUserId,
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

                // Also record in MemOS store so Memory Graph displays it
                if (userDoc?.email) {
                    const toolPrefix = toolCall.tool_name.split('_')[0] as any;
                    const validSources = ['gmail', 'calendar', 'drive', 'sheets', 'docs', 'classroom', 'manus', 'v0'];
                    const sourceTool = validSources.includes(toolPrefix) ? toolPrefix : 'orchestrator';
                    await this.memory.memosStore.storeEpisodic(
                        userDoc.email,
                        `${toolCall.tool_name}: ${result.success ? result.message?.slice(0, 200) : 'Failed — ' + (result.error || result.message)?.slice(0, 200)}`,
                        sourceTool,
                        { tags: [toolCall.tool_name, ...Object.keys(toolCall.parameters)], importance: result.success ? 'medium' : 'high' }
                    );
                }

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

    private _extractDirectSandboxCommand(input: string): string | null {
        const text = input.trim();
        if (!/e2b\s+sandbox/i.test(text)) return null;

        const patterns = [
            /in\s+(?:the\s+)?e2b\s+sandbox(?:\s+terminal)?\s*,?\s*(?:please\s+)?(?:run|execute)\s*:\s*([\s\S]+)$/i,
            /(?:run|execute)\s+in\s+(?:the\s+)?e2b\s+sandbox(?:\s+terminal)?\s*:\s*([\s\S]+)$/i,
            /e2b\s+sandbox(?:\s+terminal)?\s*:\s*([\s\S]+)$/i,
        ];

        for (const pattern of patterns) {
            const m = text.match(pattern);
            if (!m) continue;
            const cmd = this._normalizeSandboxCommand(m[1]);
            if (this._looksLikeShellCommand(cmd)) return cmd;
        }

        return null;
    }

    private _normalizeSandboxCommand(raw: string): string {
        let cmd = raw.trim();

        if (cmd.startsWith('```')) {
            cmd = cmd.replace(/^```[a-zA-Z]*\s*/i, '').replace(/```$/, '').trim();
        }
        if (/^bash\s*\n/i.test(cmd)) {
            cmd = cmd.replace(/^bash\s*\n/i, '').trim();
        }
        if (
            (cmd.startsWith('"') && cmd.endsWith('"')) ||
            (cmd.startsWith("'") && cmd.endsWith("'"))
        ) {
            cmd = cmd.slice(1, -1).trim();
        }
        return cmd;
    }

    private _looksLikeShellCommand(cmd: string): boolean {
        if (!cmd) return false;
        return /(^|\s)(cd|pwd|ls|npm|npx|node|pnpm|yarn|git|python|python3|pip|mkdir|touch|cat|echo|cp|mv|rm)\b/i.test(cmd)
            || cmd.includes('&&')
            || cmd.includes('||')
            || cmd.includes(';');
    }
}
