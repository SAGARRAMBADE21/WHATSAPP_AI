import { ToolDefinition, ToolResult, ExecutionContext } from '../types';
import { E2BSandboxManager } from '../sandbox/e2b-manager';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const V0_SCRIPT = path.resolve(__dirname, '../../skills/v0skill/scripts/v0_platform.mjs');
const V0_BASE = 'https://api.v0.dev/v1';

async function v0Api(path: string, apiKey: string): Promise<any> {
    const res = await fetch(`${V0_BASE}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`v0 API error ${res.status}: ${await res.text()}`);
    return res.json();
}

interface V0File { name: string; content: string; }

async function resolveFileContent(f: any, apiKey: string): Promise<string | null> {
    if (typeof f.content === 'string') return f.content;
    // File URLs may require the Bearer token
    if (f.url) {
        try {
            const r = await fetch(f.url, { headers: { Authorization: `Bearer ${apiKey}` } });
            if (r.ok) return await r.text();
        } catch { /* ignore */ }
        // Also try without auth (public CDN URLs)
        try {
            const r = await fetch(f.url);
            if (r.ok) return await r.text();
        } catch { /* ignore */ }
    }
    return null;
}

// Parse code blocks from AI text response: ```tsx\n// filename.tsx\ncode\n```
function parseCodeBlocks(text: string): V0File[] {
    const files: V0File[] = [];
    const seen = new Set<string>();

    // Match: ```lang\n// filename\ncode\n```  OR  ```lang filename\ncode\n```
    const re = /```[\w]*\s*\n(?:\/\/\s*(.+?)\n)?([\s\S]+?)```/g;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = re.exec(text)) !== null) {
        const rawName = (m[1] || '').trim();
        const content = (m[2] || '').trim();
        if (!content) continue;
        const name = rawName && rawName.includes('.') ? rawName : `file_${++idx}.tsx`;
        if (!seen.has(name)) { seen.add(name); files.push({ name, content }); }
    }
    return files;
}

async function getV0Files(chatId: string, apiKey: string): Promise<V0File[]> {
    const env = { ...process.env, V0_API_KEY: apiKey };

    // Attempt 1: v0 CLI get-files (returns content when available in API)
    try {
        const { stdout } = await execAsync(`node "${V0_SCRIPT}" get-files "${chatId}"`, { env, timeout: 15_000 });
        // Parse "--- filename ---\ncontent" blocks
        const blocks = stdout.split(/^--- (.+?) ---$/m).slice(1);
        const files: V0File[] = [];
        for (let i = 0; i + 1 < blocks.length; i += 2) {
            const name = blocks[i].trim();
            const content = blocks[i + 1].trim();
            if (name && content) files.push({ name, content });
        }
        if (files.length > 0) return files;
    } catch { /* fall through */ }

    // Attempt 2: direct API with authenticated URL fetches
    const seen = new Set<string>();
    const allRaw: any[] = [];
    try {
        const chat = await v0Api(`/chats/${encodeURIComponent(chatId)}`, apiKey);
        for (const f of [...(chat.files || []), ...((chat.latestVersion || {}).files || [])]) allRaw.push(f);
    } catch { /* ignore */ }
    try {
        const data = await v0Api(`/chats/${encodeURIComponent(chatId)}/messages`, apiKey);
        const messages: any[] = Array.isArray(data) ? data : (data.messages || []);
        for (const msg of messages) for (const f of msg.files || []) allRaw.push(f);
        for (const f of (Array.isArray(data) ? [] : (data.files || []))) allRaw.push(f);
    } catch { /* ignore */ }

    const result: V0File[] = [];
    for (const f of allRaw) {
        if (!f.name || seen.has(f.name)) continue;
        const content = await resolveFileContent(f, apiKey);
        if (content !== null) { seen.add(f.name); result.push({ name: f.name, content }); }
    }
    if (result.length > 0) return result;

    // Attempt 3: ask v0 AI to output all files as code blocks
    try {
        const { stdout } = await execAsync(
            `node "${V0_SCRIPT}" send-message "${chatId}" "Please output the complete code for every file in this project. For each file, start with a code block with the filename as a comment on the first line like: \`\`\`tsx\\n// filename.tsx\\n...code...\\n\`\`\`"`,
            { env, timeout: 45_000 }
        );
        const parsed = parseCodeBlocks(stdout);
        if (parsed.length > 0) return parsed;
    } catch { /* fall through */ }

    return [];
}

async function findChatId(keyword: string, apiKey: string): Promise<string | null> {
    const data = await v0Api('/chats', apiKey);
    const chats: any[] = Array.isArray(data) ? data : (data.data || data.chats || []);
    const kw = keyword.toLowerCase();
    const match = chats.find(c => (c.title || '').toLowerCase().includes(kw));
    return match?.id || null;
}

export function createV0SandboxTool(sandboxManager: E2BSandboxManager, v0ApiKey?: string): ToolDefinition {
    return {
        name: 'v0_export_to_sandbox',
        description: 'Export a v0 project/chat into the E2B sandbox, install dependencies, and start the dev server. Use when the user wants to run their v0 project locally in the sandbox.',
        parameters: {
            type: 'object',
            properties: {
                chat_id: { type: 'string', description: 'The v0 chat ID to export. If not known, provide chat_name instead.' },
                chat_name: { type: 'string', description: 'Keyword to search for the v0 chat by name (used if chat_id is unknown).' },
                project_dir: { type: 'string', description: 'Directory name inside /home/user/ to put the project. Defaults to "v0-project".' },
            },
            required: [],
        },
        execute: async (params: Record<string, any>, ctx: ExecutionContext): Promise<ToolResult> => {
            const key = v0ApiKey || process.env.V0_API_KEY;
            if (!key) return { success: false, message: '❌ V0_API_KEY is not configured. Add it to your .env file.' };

            const projectDir = `/home/user/${params.project_dir || 'v0-project'}`;
            const steps: string[] = [];

            try {
                // ── Step 1: Resolve chat ID ──────────────────────────────────
                let chatId: string = params.chat_id || '';
                if (!chatId && params.chat_name) {
                    steps.push(`🔍 Searching v0 chats for "${params.chat_name}"…`);
                    const found = await findChatId(params.chat_name, key);
                    if (!found) return { success: false, message: `❌ No v0 chat found matching "${params.chat_name}". Try listing your chats first.` };
                    chatId = found;
                    steps.push(`✅ Found chat: ${chatId}`);
                }

                if (!chatId) {
                    // No ID or name given — list chats so user can pick
                    const data = await v0Api('/chats', key);
                    const chats: any[] = Array.isArray(data) ? data : (data.data || data.chats || []);
                    if (!chats.length) return { success: false, message: '❌ No v0 chats found in your account.' };
                    // Use the most recent chat
                    chatId = chats[0].id;
                    steps.push(`📋 Using most recent v0 chat: "${chats[0].title || chatId}"`);
                }

                // ── Step 2: Fetch files from v0 ──────────────────────────────
                steps.push(`📥 Fetching files from v0 chat ${chatId}…`);
                const files = await getV0Files(chatId, key);
                if (!files.length) return { success: false, message: `❌ No files found in v0 chat ${chatId}. Make sure the chat has generated code.` };
                steps.push(`✅ Found ${files.length} file(s): ${files.map(f => f.name).join(', ')}`);

                // ── Step 3: Write files to sandbox ───────────────────────────
                steps.push(`📝 Writing files to sandbox at ${projectDir}…`);
                await sandboxManager.runCommand(ctx.userId, `mkdir -p ${projectDir}`);

                for (const file of files) {
                    const filePath = `${projectDir}/${file.name}`;
                    // Create parent dirs if needed (e.g. components/ui/button.tsx)
                    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                    if (dir !== projectDir) {
                        await sandboxManager.runCommand(ctx.userId, `mkdir -p "${dir}"`);
                    }
                    await sandboxManager.writeFile(ctx.userId, filePath, file.content);
                }
                steps.push(`✅ All files written`);

                // ── Step 4: Ensure package.json exists ───────────────────────
                const pkgCheck = await sandboxManager.runCommand(ctx.userId, `test -f ${projectDir}/package.json && echo EXISTS || echo MISSING`);
                if (pkgCheck.stdout.trim() === 'MISSING') {
                    steps.push(`📦 No package.json found — creating Next.js setup…`);
                    const pkg = JSON.stringify({
                        name: 'v0-project',
                        version: '0.1.0',
                        private: true,
                        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
                        dependencies: {
                            next: '^14.0.0',
                            react: '^18.0.0',
                            'react-dom': '^18.0.0',
                        },
                        devDependencies: {
                            typescript: '^5.0.0',
                            '@types/node': '^20.0.0',
                            '@types/react': '^18.0.0',
                            tailwindcss: '^3.0.0',
                        },
                    }, null, 2);
                    await sandboxManager.writeFile(ctx.userId, `${projectDir}/package.json`, pkg);
                }

                // ── Step 5: Install dependencies ─────────────────────────────
                steps.push(`📦 Running npm install…`);
                const install = await sandboxManager.runCommand(ctx.userId, `cd ${projectDir} && npm install --prefer-offline --no-audit --no-fund 2>&1 | tail -5`);
                if (install.exitCode !== 0) {
                    steps.push(`⚠️ npm install had warnings: ${install.stderr.slice(0, 200)}`);
                } else {
                    steps.push(`✅ Dependencies installed`);
                }

                // ── Step 6: Start dev server in background ───────────────────
                steps.push(`🚀 Starting dev server…`);
                await sandboxManager.runCommand(ctx.userId,
                    `cd ${projectDir} && nohup npm run dev -- --port 3001 > /tmp/v0-dev.log 2>&1 &`
                );

                // Wait briefly for dev server to boot
                await new Promise(r => setTimeout(r, 2000));
                const logCheck = await sandboxManager.runCommand(ctx.userId, `tail -10 /tmp/v0-dev.log 2>/dev/null || echo "Starting…"`);
                steps.push(`📋 Dev server log:\n${logCheck.stdout}`);

                const summary = steps.join('\n');
                return {
                    success: true,
                    message: `✅ *v0 Project Running in Sandbox!*\n\n${summary}\n\n` +
                        `📁 Project path: \`${projectDir}\`\n` +
                        `🌐 Dev server running on port 3001\n\n` +
                        `Open the VS Code IDE from the dashboard to view and edit files.`,
                };

            } catch (err: any) {
                return {
                    success: false,
                    message: `❌ Failed to export v0 project to sandbox.\n\nSteps completed:\n${steps.join('\n')}\n\nError: ${err.message}`,
                };
            }
        },
    };
}
