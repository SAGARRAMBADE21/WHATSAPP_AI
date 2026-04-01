// Fix DNS: Use Google DNS for SRV lookups (local router DNS may not support SRV records)
import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

import { config } from './config';
import { UserManager } from './auth/user-manager';
import { OAuthCallbackServer } from './auth/oauth-server';
import { NLPEngine } from './nlp/engine';
import { ToolRegistry } from './tools/registry';
import { MemoryManager } from './memory/manager';
import { E2BSandboxManager } from './sandbox/e2b-manager';
import { AgentCore } from './agent/core';
import { SessionManager } from './whatsapp/session-manager';
import chalk from 'chalk';

async function main(): Promise<void> {
    // Clear console for clean start
    console.clear();

    // Stylish banner
    console.log(chalk.bold.cyan('\n╔═════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('                                                         ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.bold.magenta('   🚀 ChatFuse') + chalk.bold.yellow(' (Multi-User)') + '              ' + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.gray('   AI Assistant for Google Workspace via WhatsApp        ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('                                                         ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╚═════════════════════════════════════════════════════════╝'));
    console.log(chalk.gray('   v2.0.0 | Multi-Tenant | Powered by OpenAI\n'));

    // ── Validate Configuration ──
    console.log(chalk.bold.yellow('⚙️  Validating Configuration...'));
    if (!config.openai.apiKey) {
        console.log(chalk.bold.red('   ✖ OPENAI_API_KEY is required'));
        console.log(chalk.gray('   → Set it in .env file\n'));
        process.exit(1);
    }
    if (!config.google.clientId || !config.google.clientSecret) {
        console.log(chalk.bold.red('   ✖ Google OAuth credentials are required'));
        console.log(chalk.gray('   → Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env\n'));
        process.exit(1);
    }
    if (!config.mongodb.uri) {
        console.log(chalk.bold.red('   ✖ MongoDB URI is required'));
        console.log(chalk.gray('   → Set MONGODB_URI in .env\n'));
        process.exit(1);
    }
    console.log(chalk.green('   ✓ Configuration valid\n'));

    // ── Step 1: MongoDB Connection ──
    console.log(chalk.bold.blue('━━━ STEP 1/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('💾 Connecting to MongoDB'));
    console.log(chalk.gray('   Initializing multi-user database...\n'));

    const userManager = new UserManager(config.mongodb.uri, config.mongodb.dbName);
    const dbConnected = await userManager.initialize();
    if (!dbConnected) {
        console.log(chalk.bold.red('\n   ✖ MongoDB connection failed'));
        console.log(chalk.gray('   → Check MONGODB_URI in .env'));
        console.log(chalk.yellow('   💡 For local: mongodb://localhost:27017'));
        console.log(chalk.yellow('   💡 For Atlas: mongodb+srv://user:pass@cluster.mongodb.net\n'));
        process.exit(1);
    }

    // Display user statistics
    const stats = await userManager.getUserStats();
    console.log(chalk.cyan(`   📊 Users: ${stats.total} total, ${stats.active_today} active today, ${stats.pending} pending`));

    // ── Step 2: Initialize Components ──
    console.log(chalk.bold.blue('\n━━━ STEP 2/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('⚡ Initializing AI Components'));
    console.log(chalk.gray('   Loading NLP engine, tools, and memory...\n'));

    const nlpEngine = new NLPEngine();
    console.log(chalk.gray('   ▸ NLP Engine') + chalk.green(' ✓'));

    const toolRegistry = new ToolRegistry();
    console.log(chalk.gray('   ▸ Tool Registry') + chalk.green(' ✓'));

    const memoryManager = new MemoryManager();
    await memoryManager.initialize(userManager.getDb());
    console.log(chalk.gray('   ▸ Memory Manager') + chalk.green(' ✓'));

    const sandboxManager = new E2BSandboxManager(memoryManager.memosStore);
    await sandboxManager.initialize(userManager.getDb());
    console.log(chalk.gray('   ▸ Sandbox Manager') + chalk.green(' ✓'));

    console.log(chalk.gray('\n   Tool registry initialized (tools will be loaded per-user)'));
    console.log(chalk.green('   ✓ Components ready'));

    // ── Step 3: Start Server ──
    console.log(chalk.bold.blue('\n━━━ STEP 3/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('🔐 Starting Server + OAuth'));
    console.log(chalk.gray('   Setting up HTTP server, Socket.IO, and OAuth...\n'));

    // Create a shared AgentCore for the web chat interface
    const webAgent = new AgentCore(nlpEngine, toolRegistry, memoryManager, userManager, sandboxManager);
    console.log(chalk.gray('   ▸ Web Chat Agent') + chalk.green(' ✓'));

    const oauthServer = new OAuthCallbackServer(userManager, undefined, memoryManager.memosStore, sandboxManager);
    oauthServer.setAgent(webAgent);
    await oauthServer.initChatStore(userManager.getDb());
    try {
        await oauthServer.start();
        console.log(chalk.green('   ✓ Server ready'));
        console.log(chalk.cyan('   🌐 Landing page: http://localhost:3000\n'));
    } catch (error: any) {
        console.log(chalk.bold.red('\n   ✖ Failed to start server'));
        console.log(chalk.gray(`   → ${error.message}`));
        console.log(chalk.yellow('   💡 Make sure port 3000 is not in use\n'));
        process.exit(1);
    }

    // ── Step 4: Initialize Session Manager ──
    console.log(chalk.bold.blue('━━━ STEP 4/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('📱 Starting Multi-Session WhatsApp Manager'));
    console.log(chalk.gray('   Initializing Socket.IO + SessionManager...\n'));

    const io = oauthServer.getIO()!;
    const sessionManager = new SessionManager(
        userManager.getDb(),
        io,
        userManager,
        nlpEngine,
        memoryManager,
        sandboxManager
    );

    // Restore previously connected sessions
    const restored = await sessionManager.restoreActiveSessions();
    const sessionStats = await sessionManager.getSessionStats();
    console.log(chalk.green(`   ✓ SessionManager ready`));
    console.log(chalk.cyan(`   📊 Sessions: ${sessionStats.total} total, ${restored} restored, ${sessionStats.googleConnected} with Google`));

    console.log(chalk.bold.green('\n╔═════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.green('║') + chalk.bold.white('   ✓ WORKSPACE NAVIGATOR IS RUNNING                      ') + chalk.bold.green('║'));
    console.log(chalk.bold.green('║') + chalk.yellow('   📱 Multi-Session: Anyone can connect their WhatsApp!   ') + chalk.bold.green('║'));
    console.log(chalk.bold.green('║') + chalk.cyan('   🌐 Visit http://localhost:3000 to get started           ') + chalk.bold.green('║'));
    console.log(chalk.bold.green('╚═════════════════════════════════════════════════════════╝'));
    console.log(chalk.gray('\n   Waiting for users to connect via landing page...'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    // ── Graceful Shutdown ──
    const shutdown = async () => {
        console.log(chalk.yellow('\n\n━━━ SHUTTING DOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.gray('   Cleaning up resources...'));
        memoryManager.shutdown();
        sandboxManager.shutdown();
        await userManager.shutdown();
        console.log(chalk.green('   ✓ Shutdown complete\n'));
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (err) => {
        console.log(chalk.bold.red('\n✖ Fatal Error:'), err.message);
        console.log(chalk.gray('\n   Stack trace:'));
        console.log(chalk.gray(err.stack || ''));
        shutdown();
    });
}

main().catch((err) => {
    console.log(chalk.bold.red('\n✖ Startup Failed:'), err.message);
    console.log(chalk.gray('\n   Stack trace:'));
    console.log(chalk.gray(err.stack || ''));
    process.exit(1);
});
