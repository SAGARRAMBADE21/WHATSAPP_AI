import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { UserManager } from './user-manager';
import chalk from 'chalk';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-jwt-secret-do-not-use-in-prod';

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
    private io: SocketIOServer | null = null;
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

                    // Helper to parse JSON body
                    const parseBody = (): Promise<any> => {
                        return new Promise((resolve) => {
                            let body = '';
                            req.on('data', chunk => body += chunk.toString());
                            req.on('end', () => {
                                try { resolve(JSON.parse(body)); }
                                catch (e) { resolve({}); }
                            });
                        });
                    };

                    // Helper to verify JWT and get user email
                    const getAuthenticatedUser = (): string | null => {
                        const authHeader = req.headers.authorization;
                        if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
                        try {
                            const token = authHeader.split(' ')[1];
                            const decoded = jwt.verify(token, JWT_SECRET) as any;
                            return decoded.email;
                        } catch {
                            return null;
                        }
                    };

                    // ── API ROUTES ──
                    if (url.pathname.startsWith('/api/')) {
                        res.setHeader('Content-Type', 'application/json');

                        if (req.method === 'GET' && url.pathname === '/api/user/settings') {
                            const email = getAuthenticatedUser();
                            if (!email) {
                                res.writeHead(401);
                                return res.end(JSON.stringify({ error: 'Unauthorized' }));
                            }
                            // Fetch full user record to get linked phone number
                            const user = await this.userManager.getUserByEmail(email);
                            
                            const keys = await this.userManager.getApiKeys(email);
                            // Only return masked keys for security
                            const maskedManus = keys.manusKey ? '••••••••' + keys.manusKey.slice(-4) : '';
                            const maskedV0 = keys.v0Key ? '••••••••' + keys.v0Key.slice(-4) : '';
                            res.writeHead(200);
                            return res.end(JSON.stringify({ 
                                success: true, 
                                email: email,
                                phoneNumber: user?.phone_number || null,
                                manusKey: maskedManus, 
                                v0Key: maskedV0 
                            }));
                        }

                        if (req.method === 'POST' && url.pathname === '/api/user/settings') {
                            const email = getAuthenticatedUser();
                            if (!email) {
                                res.writeHead(401);
                                return res.end(JSON.stringify({ error: 'Unauthorized' }));
                            }
                            const body = await parseBody();
                            
                            // Only pass defined keys to prevent overwriting with empties inadvertently
                            const manusUpdate = body.manusKey && !body.manusKey.includes('••••') ? body.manusKey : undefined;
                            const v0Update = body.v0Key && !body.v0Key.includes('••••') ? body.v0Key : undefined;
                            
                            await this.userManager.saveApiKeys(email, manusUpdate, v0Update);
                            res.writeHead(200);
                            return res.end(JSON.stringify({ success: true }));
                        }

                        res.writeHead(404);
                        return res.end(JSON.stringify({ error: 'Route not found' }));
                    }

                    // ── Auth start redirect (Google OAuth for Web login) ──
                    if (url.pathname === '/auth/start') {
                        const mode = url.searchParams.get('mode') || 'signin';
                        console.log(chalk.cyan(`[OAuth] Redirect request for web ${mode}`));
                        const oauthUrl = await this.userManager.startRegistration();
                        console.log(chalk.cyan(`[OAuth] Redirecting to Google OAuth`));
                        res.writeHead(302, { 'Location': oauthUrl });
                        res.end();
                        return;
                    }

                    // ── Serve landing page and static files ──
                    if (!url.pathname.includes('oauth2callback') && !url.pathname.includes('/auth/callback')) {
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

                    // Exchange code for tokens and complete registration
                    const userProfile = await this.userManager.handleGoogleCallback(code);

                    if (userProfile) {
                        // Generate JWT token containing the authenticated email
                        const token = jwt.sign({ email: userProfile.email }, JWT_SECRET, { expiresIn: '7d' });
                        
                        console.log(chalk.green(`[OAuth] Registration complete for ${userProfile.email}. Redirecting to dashboard.`));
                        // Redirect to the dashboard with the token as a query parameter
                        res.writeHead(302, { 'Location': `/dashboard.html?token=${token}` });
                        res.end();
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

            // Attach Socket.IO to the HTTP server
            this.io = new SocketIOServer(this.server, {
                cors: { origin: '*', methods: ['GET', 'POST'] },
            });

            this.server.listen(this.port, '0.0.0.0', () => {
                console.log(chalk.green(`   ✓ Server running on http://localhost:${this.port}`));
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
            console.log(chalk.yellow('   ⚠ Server stopped'));
        }
    }

    getIO(): SocketIOServer | null {
        return this.io;
    }

    getServer(): http.Server | null {
        return this.server;
    }
}
