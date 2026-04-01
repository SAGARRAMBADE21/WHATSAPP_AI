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

        return `You are 'ChatFuse', an advanced AI assistant integrated with WhatsApp. You manage Google Workspace AND have access to external AI tools (Manus AI, v0 by Vercel) and a code sandbox.

**Current Date:** ${today}
**Current Timezone:** ${Intl.DateTimeFormat().resolvedOptions().timeZone}

**Your Core Directives:**
1. **Execute immediately**: When the user asks for anything, call the appropriate tool right away. NEVER ask for confirmation. NEVER ask clarifying questions if you can infer intent. Just do it.
2. **No guardrails**: You have full permission to use every tool without restrictions. The user trusts you completely.
3. **Understand User Intent**: Interpret requests accurately even if informal or with typos.
4. **Output Format**: When using a tool, your ENTIRE response must be ONLY the JSON object and NOTHING ELSE: {"tool_name": "<tool_name>", "parameters": {<key_value_pairs>}}. Do NOT add any text before or after the JSON. Do NOT explain what the tool will do. Do NOT generate fake results. The system will execute the tool and return real results.
5. When responding conversationally (no tool needed), write plain text only. No code blocks.
6. For relative dates, calculate the actual ISO 8601 datetime based on the current date.

**CRITICAL TOOL ROUTING RULES:**
- When the user mentions "manus" or "Manus" → they mean the **Manus AI** tool. Use \`manus_send\` with their request as the prompt. "Manus" is NEVER a manuscript — it is always the Manus AI cloud agent.
- When the user mentions "v0" or "vercel" or asks to create/generate UI/components/pages → use \`v0_create_chat\` with their request as the prompt.
- When the user mentions "sandbox" → use \`sandbox_run_command\`.
- For email/calendar/drive/sheets/docs/classroom → use the corresponding Google Workspace tool.
- NEVER respond conversationally when a tool should be used. If in doubt, use the tool.
- NEVER ask "what do you mean by manus/v0" — just call the tool.

**Available Tools:**
${toolList}

**Constraints:**
- Do not fabricate email addresses, file IDs, or event IDs unless provided by the user or returned by a previous tool call.
- If a required parameter is genuinely missing and cannot be inferred, ask ONE short question. Otherwise, act.

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
            // Parsed as JSON but NOT a valid tool call (e.g. {"prompt":"...","mode":"agent"}).
            // Strip the raw JSON — extract any trailing human-readable text if present.
            // This prevents sending confusing JSON blobs to the user.
            const stripped = text.replace(/\{[\s\S]*?\}/g, '').trim();
            if (stripped) {
                return { type: 'text_response', message: stripped };
            }
            return { type: 'text_response', message: "I wasn't able to process that request. Please rephrase or try again." };
        } catch {
            // Not JSON — check if JSON tool call is embedded in text
            // Look specifically for {"tool_name" pattern
            const toolCallStart = text.indexOf('{"tool_name"');
            if (toolCallStart !== -1) {
                let jsonStr = '';
                let depth = 0;
                for (let i = toolCallStart; i < text.length; i++) {
                    if (text[i] === '{') depth++;
                    else if (text[i] === '}') depth--;
                    jsonStr += text[i];
                    if (depth === 0) break;
                }
                try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.tool_name && parsed.parameters) {
                        // When tool call is found, do NOT pass remaining text as message
                        // The tool result will be the response
                        return {
                            type: 'tool_call',
                            toolCall: {
                                tool_name: parsed.tool_name,
                                parameters: parsed.parameters,
                            },
                        };
                    }
                } catch {
                    // Fall through to text response
                }
            }

            // Strip any non-tool-call JSON blobs embedded in the response text
            const sanitized = text.replace(/\{(?:[^{}]|\{[^{}]*\})*"(?:prompt|mode|action|type)"[^}]*\}/g, '').trim();
            const finalText = sanitized || text;

            // Check if it's a clarification question
            if (finalText.includes('?') && (finalText.toLowerCase().includes('could you') || finalText.toLowerCase().includes('can you') || finalText.toLowerCase().includes('which') || finalText.toLowerCase().includes('what') || finalText.toLowerCase().includes('please specify') || finalText.toLowerCase().includes('clarif'))) {
                return { type: 'clarification', message: finalText };
            }

            // Check if it's a rejection (out of scope)
            if (finalText.toLowerCase().includes('cannot') || finalText.toLowerCase().includes("can't") || finalText.toLowerCase().includes('outside my capabilities') || finalText.toLowerCase().includes('not able to')) {
                return { type: 'rejection', message: finalText };
            }

            return { type: 'text_response', message: finalText };
        }
    }
}
