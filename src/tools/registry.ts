import { ToolDefinition } from '../types';

export class ToolRegistry {
    private tools: Map<string, ToolDefinition> = new Map();

    register(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
        console.log(`[ToolRegistry] Registered tool: ${tool.name}`);
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    getAll(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    getToolDescriptions(): string {
        return this.getAll()
            .map(
                (t) =>
                    `- **${t.name}**: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters, null, 2)}`
            )
            .join('\n\n');
    }

    getToolListForPrompt(): string {
        return this.getAll()
            .map((t) => `  * \`${t.name}\`: ${t.description}`)
            .join('\n');
    }
}