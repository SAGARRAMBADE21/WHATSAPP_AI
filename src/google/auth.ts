import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import { config } from '../config';
import { GoogleTokens } from '../types';
import chalk from 'chalk';

export class GoogleAuthManager {
  private oauth2Client: OAuth2Client;
  private tokens: GoogleTokens | null = null;
  private tokenPath: string;

  constructor(tokenPath?: string) {
    this.tokenPath = tokenPath || config.google.tokenPath;

    this.oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        this.tokens = { ...this.tokens, ...tokens } as GoogleTokens;
        this.saveTokens();
      }
    });
  }

  getClient(): OAuth2Client {
    return this.oauth2Client;
  }

  async initialize(skipInteractive: boolean = false): Promise<boolean> {
    try {
      const loaded = this.loadTokens();
      if (loaded) {
        this.oauth2Client.setCredentials(this.tokens!);
        // Verify tokens are still valid
        const tokenInfo = await this.oauth2Client.getAccessToken();
        if (tokenInfo.token) {
          console.log(chalk.green('   ✓ Authenticated with stored tokens'));
          return true;
        }
      }
    } catch (error) {
      console.log(chalk.yellow('   ⚠  Stored tokens invalid or expired'));
      if (skipInteractive) return false;
    }

    if (skipInteractive) return false;

    console.log(chalk.yellow('   ⚠  Requesting authorization (Interactive)'));
    return await this.authorizeInteractive();
  }

  /**
   * Get OAuth URL for user authorization (for WhatsApp-based registration)
   */
  getAuthUrl(state?: string): string {
    const authParams: any = {
      response_type: 'code',
      access_type: 'offline',
      scope: [...config.google.scopes],
      prompt: 'consent',
    };

    if (state) {
      authParams.state = state;
    }

    const url = this.oauth2Client.generateAuthUrl(authParams);
    console.log(chalk.cyan(`[OAuth] Generated auth URL (${url.length} chars)`));
    return url;
  }

  private async authorizeInteractive(): Promise<boolean> {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [...config.google.scopes],
      prompt: 'consent',
    });

    console.log(chalk.cyan('\n   ┌─────────────────────────────────────────────────┐'));
    console.log(chalk.cyan('   │') + chalk.bold(' 🔐 Authorization Required                     ') + chalk.cyan('│'));
    console.log(chalk.cyan('   └─────────────────────────────────────────────────┘\n'));

    console.log(chalk.bold('   💡 Steps:'));
    console.log(chalk.gray('      1. Browser will open automatically'));
    console.log(chalk.gray('      2. Sign in with your Google account'));
    console.log(chalk.gray('      3. Grant permissions for Gmail, Calendar, Drive, Sheets'));
    console.log(chalk.gray('      4. Return here for success message\n'));

    // Auto-open browser (Windows)
    try {
      const { exec } = require('child_process');
      exec(`start "" "${authUrl}"`);
      console.log(chalk.cyan('   🌐 Browser opening...\n'));
    } catch (err) {
      console.log(chalk.yellow('   ⚠  Could not auto-open browser'));
      console.log(chalk.gray('   → Please manually visit: accounts.google.com/o/oauth2\n'));
    }

    return new Promise((resolve) => {
      let resolved = false;

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error('\n❌ Authorization timeout (5 minutes). Please restart and try again.');
          server.close();
          resolve(false);
        }
      }, 5 * 60 * 1000);

      const server = http.createServer(async (req, res) => {
        if (resolved) return;

        try {
          const url = new URL(req.url!, `http://localhost:3000`);
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          // Handle OAuth errors (user denied access, etc.)
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head>
                  <title>Authorization Failed</title>
                  <style>
                    body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
                    .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
                    h1 { color: #e74c3c; }
                    .error { background: #fee; padding: 15px; border-radius: 5px; margin: 20px 0; color: #c0392b; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h1>❌ Authorization Failed</h1>
                    <div class="error">Error: ${error}</div>
                    <p>Please close this window and try again in the terminal.</p>
                  </div>
                </body>
              </html>
            `);
            server.close();
            clearTimeout(timeout);
            resolved = true;
            console.error(`\n❌ Authorization failed: ${error}`);
            resolve(false);
            return;
          }

          if (code) {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            this.tokens = tokens as GoogleTokens;
            this.saveTokens();

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head>
                  <title>Authorization Successful</title>
                  <style>
                    body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                    .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); max-width: 500px; margin: 0 auto; }
                    h1 { color: #27ae60; margin-bottom: 20px; }
                    .checkmark { font-size: 80px; }
                    p { color: #555; font-size: 18px; }
                    .note { background: #e8f5e9; padding: 15px; border-radius: 5px; margin-top: 20px; color: #2e7d32; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="checkmark">✅</div>
                    <h1>Authorization Successful!</h1>
                    <p>Your Google Workspace is now connected.</p>
                    <div class="note">
                      You can close this window and return to the terminal.
                    </div>
                  </div>
                </body>
              </html>
            `);

            server.close();
            clearTimeout(timeout);
            resolved = true;
            console.log(chalk.green('\n   ✓ Google authorization successful\n'));
            resolve(true);
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head>
                <title>Authorization Error</title>
                <style>
                  body { font-family: 'Segoe UI', sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
                  .container { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
                  h1 { color: #e74c3c; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>❌ Authorization Error</h1>
                  <p>An error occurred during authorization.</p>
                  <p>Please close this window and try again in the terminal.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          clearTimeout(timeout);
          resolved = true;
          console.log(chalk.red(`\n   ✖ Authorization error: ${err.message}`));
          resolve(false);
        }
      });

      server.listen(3000, () => {
        console.log(chalk.gray('   ⏳ Waiting for authorization...\n'));
      });

      server.on('error', (err: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log(chalk.red(`\n   ✖ Server error: ${err.message}`));
          if (err.code === 'EADDRINUSE') {
            console.log(chalk.yellow('   💡 Port 3000 is already in use. Close other apps and try again.\n'));
          }
          resolve(false);
        }
      });
    });
  }

  private loadTokens(): boolean {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(this.tokenPath)) {
        const raw = fs.readFileSync(this.tokenPath, 'utf-8');
        this.tokens = JSON.parse(raw);
        return true;
      }
    } catch (error) {
      console.log(chalk.red('[GoogleAuth] Error loading tokens:'), error);
    }
    return false;
  }

  private saveTokens(): void {
    try {
      const dir = path.dirname(this.tokenPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2));
    } catch (error) {
      console.log(chalk.red('[GoogleAuth] Error saving tokens:'), error);
    }
  }
}