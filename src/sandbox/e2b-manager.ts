import { Sandbox } from '@e2b/code-interpreter';
import { Db, Collection } from 'mongodb';
import chalk from 'chalk';
import { MemOSStore } from '../memory/memos-store';

type InstallPhase = 'idle' | 'checking' | 'downloading' | 'extracting' | 'starting' | 'ready' | 'error';

interface InstallState {
    phase: InstallPhase;
    pct: number;          // 0–100
    error?: string;
}

interface SandboxSession {
    sandboxId: string;
    userEmail: string;
    createdAt: Date;
    lastActiveAt: Date;
    status: 'running' | 'paused' | 'dead';
    ideUrl?: string;
    ideReady: boolean;
}

export class E2BSandboxManager {
    private col!: Collection<SandboxSession>;
    private memosStore: MemOSStore;
    private keepaliveTimers = new Map<string, NodeJS.Timeout>();
    private installState = new Map<string, InstallState>(); // real-time install progress
    private initialized = false;

    constructor(memosStore: MemOSStore) {
        this.memosStore = memosStore;
    }

    async initialize(db: Db): Promise<void> {
        this.col = db.collection<SandboxSession>('sandbox_sessions');
        await this.col.createIndex({ userEmail: 1 }, { unique: true });
        this.initialized = true;
        console.log(chalk.gray('   ▸ E2B Sandbox Manager ready'));
    }

    // ── Get or create sandbox ─────────────────────────────────────────────────

    async getOrCreate(userEmail: string): Promise<{ sandboxId: string; isNew: boolean; ideUrl?: string; ideReady: boolean }> {
        const existing = await this.col.findOne({ userEmail });

        if (existing && existing.status !== 'dead') {
            try {
                const sbx = await Sandbox.connect(existing.sandboxId, { apiKey: process.env.E2B_API_KEY });
                await this._keepalive(userEmail, sbx, existing.sandboxId);
                await this.col.updateOne({ userEmail }, { $set: { lastActiveAt: new Date(), status: 'running' } });

                if (existing.ideReady) {
                    this._setPhase(userEmail, 'ready', 100);
                } else {
                    // Mark as checking immediately so the first poll sees real state
                    const phase = this.installState.get(userEmail)?.phase;
                    const installing = phase === 'downloading' || phase === 'extracting' || phase === 'starting' || phase === 'checking';
                    if (!installing) {
                        this._setPhase(userEmail, 'checking', 5);
                        this._installCodeServer(userEmail, sbx).catch(() => {});
                    }
                }
                return { sandboxId: existing.sandboxId, isNew: false, ideUrl: existing.ideUrl, ideReady: existing.ideReady };
            } catch {
                console.log(chalk.yellow(`   ⚠ Sandbox expired for ${userEmail}, creating new`));
            }
        }

        const sbx = await Sandbox.create({ timeoutMs: 3600 * 1000, apiKey: process.env.E2B_API_KEY });
        const sandboxId = sbx.sandboxId;

        await this.col.updateOne(
            { userEmail },
            { $set: { sandboxId, userEmail, createdAt: new Date(), lastActiveAt: new Date(), status: 'running', ideReady: false } },
            { upsert: true }
        );

        await this._keepalive(userEmail, sbx, sandboxId);

        // Set checking phase synchronously before firing async install
        // so the very first frontend poll sees real state, not 'idle'
        this._setPhase(userEmail, 'checking', 5);
        this._installCodeServer(userEmail, sbx).catch(() => {});

        await this.memosStore.storeEpisodic(userEmail, `Sandbox created (ID: ${sandboxId})`, 'orchestrator', {
            tags: ['sandbox', 'e2b', 'created'], importance: 'medium',
        });

        console.log(chalk.green(`   ✓ Sandbox created for ${userEmail}: ${sandboxId}`));
        return { sandboxId, isNew: true, ideReady: false };
    }

    // ── Install code-server & get IDE URL ─────────────────────────────────────

    private _setPhase(userEmail: string, phase: InstallPhase, pct: number, error?: string): void {
        this.installState.set(userEmail, { phase, pct, error });
    }

    private async _installCodeServer(userEmail: string, sbx: Sandbox): Promise<void> {
        const phase = this.installState.get(userEmail)?.phase;
        if (phase === 'downloading' || phase === 'extracting' || phase === 'starting') return;

        const tag = userEmail.split('@')[0];
        const log = (msg: string) => console.log(chalk.cyan(`   [${tag}] ${msg}`));

        try {
            // ── Step 1: Already running? ──────────────────────────────────────
            log('checking port 8080…');
            const alreadyUp = await sbx.commands.run(
                'curl -sf --max-time 5 http://localhost:8080 > /dev/null 2>&1 && echo RUNNING || echo DOWN',
                { timeoutMs: 15_000 }
            );
            if (alreadyUp.stdout?.trim() === 'RUNNING') {
                log('code-server already up ✓');
                const ideUrl = `https://${sbx.getHost(8080)}`;
                await this.col.updateOne({ userEmail }, { $set: { ideUrl, ideReady: true } });
                this._setPhase(userEmail, 'ready', 100);
                return;
            }

            // ── Step 2: Install via npm if binary missing ─────────────────────
            // npm is pre-installed in E2B code-interpreter — far more reliable than
            // downloading a tarball (handles CDN, retries, partial downloads).
            const binCheck = await sbx.commands.run(
                'test -x /tmp/code-server/bin/code-server && echo YES || echo NO',
                { timeoutMs: 10_000 }
            );

            if (binCheck.stdout?.trim() !== 'YES') {
                this._setPhase(userEmail, 'downloading', 10);
                log('downloading code-server binary…');

                // Use Python (always available in E2B) to download — more reliable than curl in sandboxes
                // Python handles redirects, TLS, and retries natively without external deps
                const VERSION = '4.22.1';
                const TARURL = `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-linux-amd64.tar.gz`;

                const dlResult = await sbx.commands.run(
                    `python3 -c "
import urllib.request, sys, os
url = '${TARURL}'
dest = '/tmp/cs.tar.gz'
print('DL_START', flush=True)
try:
    urllib.request.urlretrieve(url, dest)
    print('DL_DONE', flush=True)
except Exception as e:
    print('DL_FAIL: ' + str(e), flush=True)
    sys.exit(1)
" && echo EXTRACT_START && tar -xzf /tmp/cs.tar.gz -C /tmp/ && mv -f /tmp/code-server-${VERSION}-linux-amd64 /tmp/code-server && rm -f /tmp/cs.tar.gz && echo EXTRACT_DONE`,
                    {
                        timeoutMs: 0,
                        onStdout: (line: string) => {
                            const t = line.trim();
                            log(`  dl: ${t}`);
                            if (t === 'DL_START')     this._setPhase(userEmail, 'downloading', 15);
                            if (t === 'DL_DONE')      this._setPhase(userEmail, 'downloading', 60);
                            if (t === 'EXTRACT_START') this._setPhase(userEmail, 'extracting',  65);
                            if (t === 'EXTRACT_DONE')  this._setPhase(userEmail, 'extracting',  75);
                        },
                        onStderr: (line: string) => { if (line.trim()) log(`  err: ${line.trim()}`); },
                    }
                );

                if (dlResult.exitCode !== 0) {
                    throw new Error(`Download failed (exit ${dlResult.exitCode}): ${dlResult.stdout?.slice(-200)} ${dlResult.stderr?.slice(-200)}`);
                }
                log('download + extract done ✓');
            } else {
                log('binary already exists, skipping download');
                this._setPhase(userEmail, 'extracting', 75);
            }

            // Legacy compatibility: some older launchers invoke `code-server` from PATH.
            // Keep a shim in ~/.local/bin so both absolute-path and PATH-based launches work.
            await sbx.commands.run(
                `mkdir -p /home/user/.local/bin && \
ln -sf /tmp/code-server/bin/code-server /home/user/.local/bin/code-server && \
chmod +x /home/user/.local/bin/code-server`,
                { timeoutMs: 10_000 }
            );

            // ── Step 3: Launch ────────────────────────────────────────────────
            this._setPhase(userEmail, 'starting', 78);
            log('launching code-server…');

            // Verify binary exists before launching
            const binVerify = await sbx.commands.run(
                'test -x /tmp/code-server/bin/code-server && echo BIN_OK || echo BIN_MISSING',
                { timeoutMs: 10_000 }
            );
            log(`binary check: ${binVerify.stdout?.trim()}`);
            if (binVerify.stdout?.trim().includes('BIN_MISSING')) {
                // List what actually got extracted to help debug
                const ls = await sbx.commands.run('ls /tmp/ 2>&1', { timeoutMs: 5_000 });
                throw new Error(`Binary missing. /tmp contents: ${ls.stdout?.trim()}`);
            }

            // Write a launcher script so the process survives the RPC connection closing
            await sbx.commands.run(
                `cat > /tmp/start-cs.sh << 'EOF'
#!/bin/bash
export HOME=/home/user
export PATH="/tmp/code-server/bin:/home/user/.local/bin:$PATH"
CS_BIN="/tmp/code-server/bin/code-server"
if [ ! -x "$CS_BIN" ]; then
  CS_BIN="$(command -v code-server || true)"
fi
if [ -z "$CS_BIN" ]; then
  echo "code-server binary not found" >&2
  exit 127
fi
exec "$CS_BIN" \
  --bind-addr 0.0.0.0:8080 \
  --auth none \
  --disable-telemetry \
  --disable-update-check \
  --disable-workspace-trust \
  /home/user
EOF
chmod +x /tmp/start-cs.sh`,
                { timeoutMs: 10_000 }
            );

            // Launch via the script — setsid detaches it from this shell session entirely
            await sbx.commands.run(
                'setsid /tmp/start-cs.sh > /tmp/cs.log 2>&1 < /dev/null &',
                { timeoutMs: 10_000 }
            );

            // ── Step 4: Wait for port 8080 — single shell loop ────────────────
            log('waiting for port 8080…');
            const waitResult = await sbx.commands.run(
                `for i in $(seq 1 20); do
  if curl -sf --max-time 5 http://localhost:8080 > /dev/null 2>&1; then
    echo "READY"; exit 0
  fi
  echo "WAIT $i"
  sleep 3
done
echo "TIMEOUT"
tail -40 /tmp/cs.log >&2
exit 1`,
                {
                    timeoutMs: 0,
                    onStdout: (line: string) => {
                        const t = line.trim();
                        if (t.startsWith('WAIT ')) {
                            const n = parseInt(t.split(' ')[1]) || 1;
                            this._setPhase(userEmail, 'starting', 78 + Math.round(n / 20 * 21));
                            log(`  waiting… (${n}/20)`);
                        }
                    },
                    onStderr: (line: string) => {
                        if (line.trim()) log(`  cs.log: ${line.trim()}`);
                    },
                }
            );

            if (waitResult.exitCode !== 0) {
                throw new Error(`code-server didn't respond after 60s.\n${waitResult.stderr?.slice(-400) || ''}`);
            }

            // ── Step 5: Done ──────────────────────────────────────────────────
            const ideUrl = `https://${sbx.getHost(8080)}`;
            await this.col.updateOne({ userEmail }, { $set: { ideUrl, ideReady: true } });
            this._setPhase(userEmail, 'ready', 100);
            log(`ready → ${ideUrl} ✓`);

            await this.memosStore.storeEpisodic(userEmail, `VS Code ready at ${ideUrl}`, 'orchestrator', {
                tags: ['sandbox', 'vscode', 'ide'], importance: 'high',
            });
        } catch (e: any) {
            const msg = e.message || String(e);
            this._setPhase(userEmail, 'error', 0, msg);
            console.error(chalk.red(`   ✖ [${tag}] install failed: ${msg}`));
            throw e;
        }
    }

    async getIDEUrl(userEmail: string): Promise<{ ideUrl?: string; ideReady: boolean; status: string; installPhase: InstallPhase; installPct: number; installError?: string }> {
        const session = await this.col.findOne({ userEmail });
        if (!session) return { ideReady: false, status: 'no_sandbox', installPhase: 'idle', installPct: 0 };
        const state = this.installState.get(userEmail) ?? { phase: session.ideReady ? 'ready' : 'idle' as InstallPhase, pct: session.ideReady ? 100 : 0 };
        return {
            ideUrl: session.ideUrl,
            ideReady: session.ideReady,
            status: session.status,
            installPhase: state.phase,
            installPct: state.pct,
            installError: state.error,
        };
    }

    // ── Run command ───────────────────────────────────────────────────────────

    async runCommand(userEmail: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (!command || !command.trim()) {
            return { stdout: '', stderr: 'No command provided', exitCode: 1 };
        }
        const sbx = await this._getSandbox(userEmail);
        const cmd = command.trim();
        const missingCdPath = this._extractHomeUserCdPath(cmd);

        // Proactively create /home/user/<path> targets for common "cd ... && <cmd>" flows.
        if (missingCdPath) {
            await sbx.commands.run(`mkdir -p '${missingCdPath}'`, { timeoutMs: 10_000 });
        }

        try {
            const result = await sbx.commands.run(cmd, { timeoutMs: 30_000 });
            await this.memosStore.storeEpisodic(userEmail, `Command: ${cmd.slice(0, 80)}`, 'orchestrator', {
                tags: ['sandbox', 'command'], importance: 'low',
            });
            return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.exitCode ?? 0 };
        } catch (e: any) {
            // E2B throws on non-zero exits; normalize to a stable API response.
            const errResult = e?.result;
            const stderr = errResult?.stderr ?? e?.stderr ?? e?.message ?? String(e);
            const stdout = errResult?.stdout ?? e?.stdout ?? '';
            const exitCode = errResult?.exitCode ?? 1;

            // One retry: if command failed because cd target doesn't exist under /home/user, create and rerun.
            const cdMiss = this._extractMissingCdPathFromStderr(stderr);
            if (cdMiss) {
                await sbx.commands.run(`mkdir -p '${cdMiss}'`, { timeoutMs: 10_000 });
                try {
                    const retry = await sbx.commands.run(cmd, { timeoutMs: 30_000 });
                    await this.memosStore.storeEpisodic(userEmail, `Command(retry): ${cmd.slice(0, 80)}`, 'orchestrator', {
                        tags: ['sandbox', 'command'], importance: 'low',
                    });
                    return { stdout: retry.stdout ?? '', stderr: retry.stderr ?? '', exitCode: retry.exitCode ?? 0 };
                } catch (retryErr: any) {
                    const retryResult = retryErr?.result;
                    return {
                        stdout: retryResult?.stdout ?? '',
                        stderr: retryResult?.stderr ?? retryErr?.message ?? String(retryErr),
                        exitCode: retryResult?.exitCode ?? 1,
                    };
                }
            }

            await this.memosStore.storeEpisodic(userEmail, `Command failed: ${cmd.slice(0, 80)}`, 'orchestrator', {
                tags: ['sandbox', 'command', 'error'], importance: 'low',
            });
            return { stdout, stderr, exitCode };
        }
    }

    private _extractHomeUserCdPath(command: string): string | null {
        const m = command.match(/(?:^|&&|;|\|\|)\s*cd\s+['"]?(\/home\/user\/[A-Za-z0-9._/\-]+)['"]?(?=\s|$)/);
        if (!m) return null;
        const p = m[1].replace(/\/+/g, '/');
        if (p.includes('/../') || p.endsWith('/..')) return null;
        return p;
    }

    private _extractMissingCdPathFromStderr(stderr: string): string | null {
        const m = stderr.match(/cd:\s+(\/home\/user\/[^:]+):\s+No such file or directory/i);
        if (!m) return null;
        const p = m[1].trim().replace(/\/+/g, '/');
        if (p.includes('/../') || p.endsWith('/..')) return null;
        return p;
    }

    // ── File operations ───────────────────────────────────────────────────────

    async writeFile(userEmail: string, filePath: string, content: string): Promise<void> {
        const sbx = await this._getSandbox(userEmail);
        await sbx.files.write(filePath, content);
        await this.memosStore.storeEpisodic(userEmail, `Wrote file: ${filePath}`, 'orchestrator', {
            tags: ['sandbox', 'file'], importance: 'low',
        });
    }

    async readFile(userEmail: string, filePath: string): Promise<string> {
        const sbx = await this._getSandbox(userEmail);
        return sbx.files.read(filePath);
    }

    async listFiles(userEmail: string, dirPath = '/home/user'): Promise<string[]> {
        const sbx = await this._getSandbox(userEmail);
        const files = await sbx.files.list(dirPath);
        return files.map((f: any) => f.name);
    }

    // ── Open project ──────────────────────────────────────────────────────────

    async openProject(userEmail: string, projectName: string, repoUrl?: string): Promise<string> {
        const sbx = await this._getSandbox(userEmail);
        const projectPath = `/home/user/${projectName}`;

        if (repoUrl) {
            await sbx.commands.run(`git clone ${repoUrl} ${projectPath}`, { timeoutMs: 60_000 });
        } else {
            await sbx.commands.run(`mkdir -p ${projectPath}`);
        }

        await this._injectMemoryContext(userEmail, sbx, projectPath);

        await this.memosStore.storeSemantic(
            userEmail,
            `Project "${projectName}" opened${repoUrl ? ` from ${repoUrl}` : ''}`,
            projectName, 'orchestrator',
            { tags: ['sandbox', 'project', projectName], importance: 'high' }
        );

        return projectPath;
    }

    // ── Info / Kill ───────────────────────────────────────────────────────────

    async getSandboxInfo(userEmail: string): Promise<SandboxSession | null> {
        return this.col.findOne({ userEmail });
    }

    async kill(userEmail: string): Promise<void> {
        const session = await this.col.findOne({ userEmail });
        if (!session) return;
        try {
            const sbx = await Sandbox.connect(session.sandboxId, { apiKey: process.env.E2B_API_KEY });
            await sbx.kill();
        } catch {}
        this._clearKeepalive(userEmail);
        await this.col.updateOne({ userEmail }, { $set: { status: 'dead', ideReady: false, ideUrl: undefined } });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _getSandbox(userEmail: string): Promise<Sandbox> {
        const { sandboxId } = await this.getOrCreate(userEmail);
        return Sandbox.connect(sandboxId, { apiKey: process.env.E2B_API_KEY });
    }

    private async _keepalive(userEmail: string, sbx: Sandbox, sandboxId: string): Promise<void> {
        this._clearKeepalive(userEmail);
        const timer = setInterval(async () => {
            try {
                await sbx.commands.run('echo keepalive');
                await this.col.updateOne({ userEmail }, { $set: { lastActiveAt: new Date() } });
            } catch {
                this._clearKeepalive(userEmail);
                await this.col.updateOne({ userEmail }, { $set: { status: 'dead' } });
            }
        }, 60_000);
        this.keepaliveTimers.set(userEmail, timer);
    }

    private _clearKeepalive(userEmail: string): void {
        const t = this.keepaliveTimers.get(userEmail);
        if (t) { clearInterval(t); this.keepaliveTimers.delete(userEmail); }
    }

    private async _injectMemoryContext(userEmail: string, sbx: Sandbox, projectPath: string): Promise<void> {
        try {
            const memories = await this.memosStore.retrieve(userEmail, projectPath, { limit: 10 });
            if (!memories.length) return;
            const lines = memories.map(m => `- [${m.tier}] ${m.content}`).join('\n');
            await sbx.files.write(`${projectPath}/.context.md`,
                `# Memory Context\nUpdated: ${new Date().toISOString()}\n\n${lines}\n`);
        } catch {}
    }

    shutdown(): void {
        for (const [email] of this.keepaliveTimers) this._clearKeepalive(email);
    }
}
