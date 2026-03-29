import { ToolDefinition, ToolResult, ExecutionContext } from '../types';
import { E2BSandboxManager } from '../sandbox/e2b-manager';

export function createSandboxTools(sandboxManager: E2BSandboxManager): ToolDefinition[] {
    return [
        {
            name: 'sandbox_run_command',
            description: 'Run a shell command inside the user\'s sandbox VM. Use for executing code, installing packages, running tests, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to execute' },
                },
                required: ['command'],
            },
            execute: async (params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    const result = await sandboxManager.runCommand(ctx.userId, params.command);
                    const output = [
                        result.stdout && `stdout:\n${result.stdout}`,
                        result.stderr && `stderr:\n${result.stderr}`,
                    ].filter(Boolean).join('\n');
                    return {
                        success: result.exitCode === 0,
                        data: result,
                        message: output || `Command exited with code ${result.exitCode}`,
                    };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to run command: ${e.message}` };
                }
            },
        },

        {
            name: 'sandbox_write_file',
            description: 'Write content to a file in the sandbox filesystem.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path inside sandbox (e.g. /home/user/project/index.ts)' },
                    content: { type: 'string', description: 'File content to write' },
                },
                required: ['path', 'content'],
            },
            execute: async (params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    await sandboxManager.writeFile(ctx.userId, params.path, params.content);
                    return { success: true, message: `File written: ${params.path}` };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to write file: ${e.message}` };
                }
            },
        },

        {
            name: 'sandbox_read_file',
            description: 'Read the content of a file from the sandbox filesystem.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute file path to read' },
                },
                required: ['path'],
            },
            execute: async (params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    const content = await sandboxManager.readFile(ctx.userId, params.path);
                    return { success: true, data: content, message: content };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to read file: ${e.message}` };
                }
            },
        },

        {
            name: 'sandbox_open_project',
            description: 'Open or clone a project into the sandbox. Optionally provide a git repo URL.',
            parameters: {
                type: 'object',
                properties: {
                    project_name: { type: 'string', description: 'Project directory name' },
                    repo_url: { type: 'string', description: 'Optional git URL to clone' },
                },
                required: ['project_name'],
            },
            execute: async (params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    const path = await sandboxManager.openProject(ctx.userId, params.project_name, params.repo_url);
                    return { success: true, data: { path }, message: `Project opened at ${path}` };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to open project: ${e.message}` };
                }
            },
        },

        {
            name: 'sandbox_list_files',
            description: 'List files in a sandbox directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to list (default: /home/user)' },
                },
                required: [],
            },
            execute: async (params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    const files = await sandboxManager.listFiles(ctx.userId, params.path || '/home/user');
                    return { success: true, data: files, message: files.join('\n') || 'Empty directory' };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to list files: ${e.message}` };
                }
            },
        },

        {
            name: 'sandbox_status',
            description: 'Get the current sandbox status and info for the user.',
            parameters: { type: 'object', properties: {}, required: [] },
            execute: async (_params, ctx: ExecutionContext): Promise<ToolResult> => {
                try {
                    const info = await sandboxManager.getSandboxInfo(ctx.userId);
                    if (!info) return { success: true, message: 'No sandbox created yet.' };
                    return {
                        success: true,
                        data: info,
                        message: `Sandbox ${info.sandboxId} — status: ${info.status}, last active: ${info.lastActiveAt.toLocaleString()}`,
                    };
                } catch (e: any) {
                    return { success: false, error: e.message, message: `Failed to get sandbox status: ${e.message}` };
                }
            },
        },
    ];
}
