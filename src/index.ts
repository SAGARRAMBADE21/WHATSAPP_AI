import { config } from './config';
import { GoogleAuthManager } from './google/auth';
import { NLPEngine } from './nlp/engine';
import { AgentCore } from './agent/core';
import { ToolRegistry } from './tools/registry';
import { MemoryManager } from './memory/manager';
import { WhatsAppClient } from './whatsapp/client';
import { createGmailTools } from './tools/gmail';
import { createCalendarTools } from './tools/calendar';
import { createDriveTools } from './tools/drive';
import { createSheetsTools } from './tools/sheets';
import chalk from 'chalk';

async function main(): Promise<void> {
    // Clear console for clean start
    console.clear();

    // Stylish banner
    console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('                                                   ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.bold.magenta('   🚀 Workspace Navigator') + '                         ' + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.gray('   AI Assistant for Google Workspace via WhatsApp  ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white('                                                   ') + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════╝'));
    console.log(chalk.gray('   v1.0.0 | Powered by OpenAI\n'));

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
    console.log(chalk.green('   ✓ Configuration valid\n'));

    // ── Step 1: Google Authentication ──
    console.log(chalk.bold.blue('━━━ STEP 1/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('🔐 Google Authentication'));
    console.log(chalk.gray('   Connecting to Google Workspace...\n'));

    const googleAuth = new GoogleAuthManager();
    const authSuccess = await googleAuth.initialize();
    if (!authSuccess) {
        console.log(chalk.bold.red('\n   ✖ Google authentication failed'));
        console.log(chalk.gray('   → Please check your credentials and try again\n'));
        process.exit(1);
    }

    // ── Step 2: Initialize Components ──
    console.log(chalk.bold.blue('\n━━━ STEP 2/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('⚡ Initializing AI Components'));
    console.log(chalk.gray('   Loading NLP engine, tools, and memory...\n'));

    const nlpEngine = new NLPEngine();
    console.log(chalk.gray('   ▸ NLP Engine') + chalk.green(' ✓'));

    const toolRegistry = new ToolRegistry();
    console.log(chalk.gray('   ▸ Tool Registry') + chalk.green(' ✓'));

    const memoryManager = new MemoryManager();
    console.log(chalk.gray('   ▸ Memory Manager') + chalk.green(' ✓'));

    // Register all tools
    const authClient = googleAuth.getClient();
    console.log(chalk.gray('\n   Registering workspace tools...'));

    const gmailTools = createGmailTools(authClient);
    console.log(chalk.gray('   ▸ Gmail') + chalk.cyan(` (${gmailTools.length} tools)`) + chalk.green(' ✓'));

    const calendarTools = createCalendarTools(authClient);
    console.log(chalk.gray('   ▸ Calendar') + chalk.cyan(` (${calendarTools.length} tools)`) + chalk.green(' ✓'));

    const driveTools = createDriveTools(authClient);
    console.log(chalk.gray('   ▸ Drive') + chalk.cyan(` (${driveTools.length} tools)`) + chalk.green(' ✓'));

    const sheetsTools = createSheetsTools(authClient);
    console.log(chalk.gray('   ▸ Sheets') + chalk.cyan(` (${sheetsTools.length} tools)`) + chalk.green(' ✓'));

    [...gmailTools, ...calendarTools, ...driveTools, ...sheetsTools].forEach((tool) =>
        toolRegistry.register(tool)
    );

    const totalTools = toolRegistry.getAll().length;
    console.log(chalk.bold.green(`\n   ✓ ${totalTools} tools ready`));

    // ── Step 3: Initialize Agent ──
    console.log(chalk.bold.blue('\n━━━ STEP 3/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('🤖 Starting AI Agent Core'));
    console.log(chalk.gray('   Initializing OpenAI-powered agent...\n'));

    const agent = new AgentCore(nlpEngine, toolRegistry, memoryManager);
    console.log(chalk.green('   ✓ Agent ready\n'));

    // ── Step 4: Start WhatsApp ──
    console.log(chalk.bold.blue('━━━ STEP 4/4 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold('📱 Connecting to WhatsApp'));
    console.log(chalk.gray('   Establishing connection...\n'));

    const whatsapp = new WhatsAppClient(agent);
    await whatsapp.start();

    console.log(chalk.bold.green('\n╔═══════════════════════════════════════════════════╗'));
    console.log(chalk.bold.green('║') + chalk.bold.white('   ✓ WORKSPACE NAVIGATOR IS RUNNING                ') + chalk.bold.green('║'));
    console.log(chalk.bold.green('╚═══════════════════════════════════════════════════╝'));
    console.log(chalk.gray('\n   Listening for WhatsApp messages...'));
    console.log(chalk.gray('   Press Ctrl+C to stop\n'));

    // ── Graceful Shutdown ──
    const shutdown = () => {
        console.log(chalk.yellow('\n\n━━━ SHUTTING DOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.gray('   Cleaning up resources...'));
        memoryManager.shutdown();
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