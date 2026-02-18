import OpenAI from 'openai';
import { config } from '../config';
import { NLPResponse, ConversationTurn, ToolDefinition } from '../types';

export class NLPEngine {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({ apiKey: config.openai.apiKey });
    }

    buildSystemPrompt(toolList: string, memoryContext: string): string {
        const today = new Date().toISOString().split('T')[0];

        return `You are 'Workspace Navigator', an advanced AI assistant integrated with WhatsApp, designed to manage Google Workspace tasks for the user.

**Current Date:** ${today}
**Current Timezone:** ${Intl.DateTimeFormat().resolvedOptions().timeZone}

**Your Core Directives:**
1. **Understand User Intent**: Accurately interpret user requests, even if they are informal, use slang, or contain typos. Infer meaning from context.
2. **Utilize Available Tools**: You have access to a suite of specialized tools for Gmail, Google Calendar, Google Drive, and Google Sheets. Always use the appropriate tool to fulfill a request.
3. **Prioritize Security and Privacy**: Always respect user permissions and data privacy. Never expose sensitive data.
4. **Seek Clarification**: If a request is ambiguous, incomplete, or could lead to unintended consequences (e.g., deleting important data), ask the user for clarification BEFORE executing a tool. Phrase clarifications as concise questions.
5. **Provide Clear Feedback**: After executing a tool, report the outcome clearly and concisely.
6. **Maintain Context**: Use the conversation history and user context provided to understand follow-up questions and references to previous statements.
7. **Output Format**: When you decide to use a tool, output ONLY a valid JSON object in this exact format:
   \`{"tool_name": "<tool_name>", "parameters": {<parameter_key_value_pairs>}}\`
   Do NOT wrap the JSON in markdown code blocks. Output raw JSON only.
8. When you need to respond conversationally (no tool needed), just write your response as plain text.
9. When a request is outside your capabilities, politely decline and explain what you CAN do.
10. For relative dates like "tomorrow", "next Monday", "in 2 hours", calculate the actual ISO 8601 datetime based on the current date.

**Available Tools:**
${toolList}

**Constraints:**
- You operate solely within the confines of the provided tools.
- Do not fabricate or assume email addresses, file IDs, or event IDs unless provided by the user or from previous tool results in context.
- For destructive operations (delete, modify), confirm with the user if the intent seems uncertain.

${memoryContext ? `**User Context & Memory:**\n${memoryContext}` : ''}`;
    }

    async processMessage(
        userMessage: string,
        conversationHistory: ConversationTurn[],
        tools: ToolDefinition[],
        memoryContext: string
    ): Promise<NLPResponse> {
        const toolList = tools
            .map(
                (t) =>
                    `- \`${t.name}\`: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`
            )
            .join('\n\n');

        const systemPrompt = this.buildSystemPrompt(toolList, memoryContext);

        // Build messages array from conversation history
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = conversationHistory.map((turn) => ({
            role: turn.role === 'user' ? 'user' : 'assistant',
            content: turn.content,
        }));

        // Add current user message
        messages.push({ role: 'user', content: userMessage });

        try {
            console.log(`[NLP] Calling OpenAI API with model: ${config.openai.model}`);
            const startTime = Date.now();

            const response = await this.client.chat.completions.create({
                model: config.openai.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages
                ],
                temperature: 0.7,
                max_completion_tokens: 4096,
            });

            const elapsed = Date.now() - startTime;
            console.log(`[NLP] OpenAI API responded in ${elapsed}ms`);

            const text = response.choices[0]?.message?.content?.trim() || '';
            console.log(`[NLP] Response: ${text.substring(0, 100)}...`);

            return this.parseResponse(text);
        } catch (error: any) {
            console.error('[NLP] OpenAI API error:', error.message);
            console.error('[NLP] Error details:', error);
            return {
                type: 'text_response',
                message: 'I encountered an error processing your request. Please try again.',
            };
        }
    }

    private parseResponse(text: string): NLPResponse {
        // Try to extract JSON tool call from the response
        // Handle cases where the model might wrap it in backticks
        let cleanText = text.trim();

        // Remove markdown code block wrappers if present
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.slice(7);
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.slice(3);
        }
        if (cleanText.endsWith('```')) {
            cleanText = cleanText.slice(0, -3);
        }
        cleanText = cleanText.trim();

        // Attempt to parse as JSON (tool call)
        try {
            const parsed = JSON.parse(cleanText);
            if (parsed.tool_name && parsed.parameters) {
                return {
                    type: 'tool_call',
                    toolCall: {
                        tool_name: parsed.tool_name,
                        parameters: parsed.parameters,
                    },
                };
            }
        } catch {
            // Not JSON — check if JSON is embedded in text
            const jsonMatch = text.match(/\{[\s\S]*"tool_name"[\s\S]*"parameters"[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.tool_name && parsed.parameters) {
                        return {
                            type: 'tool_call',
                            toolCall: {
                                tool_name: parsed.tool_name,
                                parameters: parsed.parameters,
                            },
                            message: text.replace(jsonMatch[0], '').trim() || undefined,
                        };
                    }
                } catch {
                    // Fall through to text response
                }
            }
        }

        // Check if it's a clarification question
        if (text.includes('?') && (text.toLowerCase().includes('could you') || text.toLowerCase().includes('can you') || text.toLowerCase().includes('which') || text.toLowerCase().includes('what') || text.toLowerCase().includes('please specify') || text.toLowerCase().includes('clarif'))) {
            return { type: 'clarification', message: text };
        }

        // Check if it's a rejection (out of scope)
        if (text.toLowerCase().includes('cannot') || text.toLowerCase().includes("can't") || text.toLowerCase().includes('outside my capabilities') || text.toLowerCase().includes('not able to')) {
            return { type: 'rejection', message: text };
        }

        // Default: text response
        return { type: 'text_response', message: text };
    }
}