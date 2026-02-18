import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { UserManager } from './user-manager';
import chalk from 'chalk';

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
};

export class OAuthCallbackServer {
    private server: http.Server | null = null;
    private userManager: UserManager;
    private port: number = 3000;

    constructor(userManager: UserManager, port?: number) {
        this.userManager = userManager;
        if (port) this.port = port;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url!, `http://localhost:${this.port}`);

                    // ── Serve landing page and static files ──
                    if (!url.pathname.includes('oauth2callback')) {
                        const publicDir = path.resolve(__dirname, '../../public');

                        // Serve index.html for root path
                        let filePath = url.pathname === '/'
                            ? path.join(publicDir, 'index.html')
                            : path.join(publicDir, url.pathname);

                        // Security: prevent directory traversal
                        if (!filePath.startsWith(publicDir)) {
                            res.writeHead(403, { 'Content-Type': 'text/html' });
                            res.end('<h1>403 - Forbidden</h1>');
                            return;
                        }

                        try {
                            const stat = fs.statSync(filePath);
                            if (stat.isDirectory()) {
                                filePath = path.join(filePath, 'index.html');
                            }
                            const ext = path.extname(filePath).toLowerCase();
                            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                            const content = fs.readFileSync(filePath);
                            res.writeHead(200, { 'Content-Type': contentType });
                            res.end(content);
                        } catch {
                            res.writeHead(404, { 'Content-Type': 'text/html' });
                            res.end('<h1>404 - Not Found</h1>');
                        }
                        return;
                    }

                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const error = url.searchParams.get('error');

                    // Handle OAuth errors
                    if (error) {
                        console.error(chalk.red(`[OAuth] Authorization error: ${error}`));
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(this.getErrorPage(error));
                        return;
                    }

                    // Missing authorization code
                    if (!code) {
                        console.error(chalk.red('[OAuth] No authorization code received'));
                        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(this.getErrorPage('No authorization code received'));
                        return;
                    }

                    console.log(chalk.cyan(`[OAuth] Received callback with code: ${code.substring(0, 10)}...`));
                    if (state) {
                        console.log(chalk.cyan(`[OAuth] State parameter (phone): ${state}`));
                    }

                    // Exchange code for tokens and complete registration
                    const success = await this.handleOAuthCallback(code, state || undefined);

                    if (success) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(this.getSuccessPage());
                    } else {
                        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(this.getErrorPage('Failed to complete registration'));
                    }

                } catch (error: any) {
                    console.error(chalk.red('[OAuth] Error handling callback:'), error);
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(this.getErrorPage(error.message));
                }
            });

            this.server.listen(this.port, '0.0.0.0', () => {
                console.log(chalk.green(`   ✓ OAuth callback server running on http://localhost:${this.port}`));
                resolve();
            });

            this.server.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    console.error(chalk.red(`   ✖ Port ${this.port} is already in use`));
                    reject(new Error(`Port ${this.port} already in use`));
                } else {
                    reject(error);
                }
            });
        });
    }

    private async handleOAuthCallback(code: string, state?: string): Promise<boolean> {
        try {
            // If state is provided, use it to identify the specific user
            if (state) {
                console.log(chalk.cyan(`[OAuth] Processing registration for user: ${state}`));
                const success = await this.userManager.completeRegistrationWithCode(state, code);
                if (success) {
                    console.log(chalk.green(`   ✓ Registration completed for ${state}`));
                    return true;
                } else {
                    console.log(chalk.red(`   ✖ Registration failed for ${state}`));
                    return false;
                }
            }

            // Fallback: try all pending registrations (shouldn't happen with state parameter)
            const pendingUsers = await this.userManager.getPendingRegistrations();

            if (pendingUsers.length === 0) {
                console.log(chalk.yellow('[OAuth] No pending registrations found'));
                return false;
            }

            // Try to complete registration for each pending user
            for (const phoneNumber of pendingUsers) {
                try {
                    const success = await this.userManager.completeRegistrationWithCode(phoneNumber, code);
                    if (success) {
                        console.log(chalk.green(`[OAuth] ✓ Registration completed for ${phoneNumber}`));
                        return true;
                    }
                } catch (error: any) {
                    console.log(chalk.yellow(`[OAuth] Failed to complete registration for ${phoneNumber}: ${error.message}`));
                    continue;
                }
            }

            return false;
        } catch (error: any) {
            console.error(chalk.red('[OAuth] Error in handleOAuthCallback:'), error);
            return false;
        }
    }

    private getSuccessPage(): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Authorization Successful</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 100%;
            text-align: center;
            animation: slideIn 0.5s ease;
        }
        @keyframes slideIn {
            from { transform: translateY(-30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .success-icon {
            width: 80px;
            height: 80px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            animation: scaleIn 0.5s ease 0.2s both;
        }
        @keyframes scaleIn {
            from { transform: scale(0); }
            to { transform: scale(1); }
        }
        .success-icon::before {
            content: "✓";
            color: white;
            font-size: 48px;
            font-weight: bold;
        }
        h1 { color: #1f2937; margin-bottom: 15px; font-size: 28px; }
        p { color: #6b7280; margin-bottom: 15px; line-height: 1.6; font-size: 16px; }
        .whatsapp { background: #25d366; color: white; padding: 12px 24px; border-radius: 10px; display: inline-block; margin-top: 20px; font-weight: 600; }
        .footer { color: #9ca3af; font-size: 14px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon"></div>
        <h1>🎉 Authorization Successful!</h1>
        <p>Your Google Workspace account has been connected successfully.</p>
        <p><strong>You can now close this window</strong> and return to WhatsApp.</p>
        <div class="whatsapp">✓ Return to WhatsApp</div>
        <div class="footer">Send any message to start using your AI assistant!</div>
    </div>
</body>
</html>
        `;
    }

    private getErrorPage(error: string): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Authorization Failed</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        .error-icon {
            width: 80px;
            height: 80px;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
        }
        .error-icon::before {
            content: "✕";
            color: white;
            font-size: 48px;
            font-weight: bold;
        }
        h1 { color: #1f2937; margin-bottom: 15px; font-size: 28px; }
        p { color: #6b7280; margin-bottom: 15px; line-height: 1.6; font-size: 16px; }
        .error-details {
            background: #fee;
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            color: #c0392b;
            font-family: monospace;
            font-size: 14px;
        }
        .retry { background: #3b82f6; color: white; padding: 12px 24px; border-radius: 10px; display: inline-block; margin-top: 20px; font-weight: 600; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon"></div>
        <h1>❌ Authorization Failed</h1>
        <p>There was a problem connecting your Google account.</p>
        <div class="error-details">${this.escapeHtml(error)}</div>
        <p>Please return to WhatsApp and try again by sending <strong>/register</strong></p>
    </div>
</body>
</html>
        `;
    }

    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            console.log(chalk.yellow('   ⚠ OAuth callback server stopped'));
        }
    }
}
