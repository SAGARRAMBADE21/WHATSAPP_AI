import { MongoClient, Db, Collection } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthManager } from '../google/auth';
import { GoogleTokens } from '../types';
import { config } from '../config';
import path from 'path';
import chalk from 'chalk';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { encryptText, decryptText } from './crypto';

export interface User {
    email: string;
    phone_number?: string;
    name?: string;
    created_at: Date;
    last_active: Date;
    is_active: boolean;
    registration_status: 'pending' | 'completed';
    manus_api_key?: string; // Encrypted stored AES string
    v0_api_key?: string;    // Encrypted stored AES string
}

export interface UserToken {
    email?: string;
    phone_number?: string;
    access_token: string;
    refresh_token: string;
    expiry_date: number;
    scope: string;
    token_type: string;
    updated_at: Date;
}

export interface UserPreferences {
    phone_number: string;
    timezone: string;
    language: string;
    notification_enabled: boolean;
}

/**
 * Multi-user manager that handles user registration, authentication,
 * and per-user Google OAuth token management using MongoDB.
 */
export class UserManager {
    private client!: MongoClient;
    private db!: Db;
    private users!: Collection<User>;
    private tokens!: Collection<UserToken>;
    private preferences!: Collection<UserPreferences>;
    private userAuthClients: Map<string, { client: OAuth2Client; authManager: GoogleAuthManager; cachedAt: number }> = new Map();
    private pendingRegistrations: Map<string, { timestamp: number; authUrl: string }> = new Map();
    private isConnected: boolean = false;
    private refreshWorkerInterval: NodeJS.Timeout | null = null;

    // Re-validate cached auth clients every 45 minutes (access tokens last ~60 min)
    private static readonly AUTH_CACHE_TTL_MS = 45 * 60 * 1000;
    
    // Run the background refresh worker every 55 minutes
    private static readonly REFRESH_WORKER_INTERVAL_MS = 55 * 60 * 1000;

    constructor(private mongoUri: string = 'mongodb://localhost:27017', private dbName: string = 'workspace_navigator') { }

    /**
     * Get the MongoDB database instance (for sharing with other modules)
     */
    getDb(): Db {
        return this.db;
    }

    /**
     * Initialize MongoDB connection and collections
     * Includes retry logic for when Atlas clusters are resuming from paused state
     */
    async initialize(): Promise<boolean> {
        const maxRetries = 5;
        const baseDelay = 5000; // 5 seconds

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    const delay = baseDelay * attempt;
                    console.log(chalk.yellow(`   ⏳ Retry ${attempt}/${maxRetries} in ${delay / 1000}s... (cluster may be resuming)`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                this.client = new MongoClient(this.mongoUri, {
                    serverSelectionTimeoutMS: 30000,  // 30s to select a server
                    connectTimeoutMS: 30000,          // 30s to establish connection
                    socketTimeoutMS: 45000,           // 45s socket timeout
                });
                await this.client.connect();

                this.db = this.client.db(this.dbName);
                this.users = this.db.collection<User>('users');
                this.tokens = this.db.collection<UserToken>('tokens');
                this.preferences = this.db.collection<UserPreferences>('preferences');

                // Ensure indexes — sparse:true prevents DuplicateKey on null fields
                const safeIndex = async (col: any, key: any, opts: any = {}) => {
                    try {
                        await col.createIndex(key, opts);
                    } catch (idxErr: any) {
                        if (idxErr.code === 86) {
                            // IndexKeySpecsConflict: drop old index and recreate
                            const indexName = Object.entries(key as Record<string, number>)
                                .map(([k, v]) => `${k}_${v}`).join('_');
                            try { await col.dropIndex(indexName); } catch { /* ok */ }
                            await col.createIndex(key, opts);
                        } else {
                            throw idxErr;
                        }
                    }
                };

                await safeIndex(this.users, { email: 1 }, { unique: true, sparse: true });
                await safeIndex(this.users, { phone_number: 1 }, { unique: true, sparse: true });
                await safeIndex(this.tokens, { email: 1 }, { unique: true, sparse: true });
                await safeIndex(this.preferences, { email: 1 }, { unique: true, sparse: true });
                await safeIndex(this.users, { last_active: -1 });

                this.isConnected = true;
                console.log(chalk.green('   ✓ MongoDB connected'));
                console.log(chalk.gray(`   ▸ Database: ${this.dbName}`));

                // Start the background token refresh worker
                this.startTokenRefreshWorker();

                return true;
            } catch (error: any) {
                const isLastAttempt = attempt === maxRetries;
                if (isLastAttempt) {
                    console.error(chalk.red('   ✖ MongoDB connection failed after all retries:'), error);
                    return false;
                }
                console.log(chalk.yellow(`   ⚠ Connection attempt ${attempt} failed: ${error.code || error.message}`));
            }
        }
        return false;
    }

    /**
     * Check if user is registered and active by phone number
     */
    async isUserRegistered(phoneNumber: string): Promise<boolean> {
        const user = await this.users.findOne({
            phone_number: phoneNumber,
            is_active: true,
            registration_status: 'completed'
        });
        return !!user;
    }

    /**
     * Get user information
     */
    async getUserByPhone(phoneNumber: string): Promise<User | null> {
        return await this.users.findOne({ phone_number: phoneNumber });
    }

    async getUserByEmail(email: string): Promise<User | null> {
        return await this.users.findOne({ email });
    }

    /**
     * Start user registration process - generate Google OAuth URL
     */
    async startRegistration(): Promise<string> {
        // We no longer require a phone number to start.
        // We just create an anonymous GoogleAuthManager to get the OAuth URL
        const authManager = new GoogleAuthManager();
        return authManager.getAuthUrl('register'); // Use a generic state
    }

    /**
     * Handles Google OAuth callback, creates or updates the user by email,
     * and saves their Google OAuth refresh/access tokens.
     */
    async handleGoogleCallback(code: string): Promise<{ email: string; name: string } | null> {
        try {
            const authManager = new GoogleAuthManager();
            const client = authManager.getClient();
            const { tokens } = await client.getToken(code);
            client.setCredentials(tokens);

            // Fetch user profile from Google to get their email
            const oauth2 = require('googleapis').google.oauth2({ version: 'v2', auth: client });
            const userInfo = await oauth2.userinfo.get();
            const email = userInfo.data.email;
            const name = userInfo.data.name;

            if (!email) throw new Error('Google OAuth did not return an email address');

            // Save tokens to the email-keyed file path (digits only from email)
            const userTokenPath = this.getUserTokenPath(email);
            fs.mkdirSync(path.dirname(userTokenPath), { recursive: true });
            fs.writeFileSync(userTokenPath, JSON.stringify(tokens, null, 2));

            // If phone number already linked, also write to phone-specific token file
            // so WhatsApp auth flow immediately picks up the fresh token
            const existingUser = await this.users.findOne({ email });
            if (existingUser?.phone_number) {
                const phoneTokenPath = this.getUserTokenPath(existingUser.phone_number);
                fs.writeFileSync(phoneTokenPath, JSON.stringify(tokens, null, 2));
                // Invalidate cached auth client so next request loads fresh tokens
                this.userAuthClients.delete(existingUser.phone_number);
                console.log(chalk.green(`   ✓ Token also saved to phone file for ${existingUser.phone_number}`));
            }

            // Upsert user in DB
            await this.users.updateOne(
                { email },
                {
                    $set: {
                        email,
                        name: name || '',
                        last_active: new Date(),
                        is_active: true,
                        registration_status: 'completed'
                    },
                    $setOnInsert: {
                        created_at: new Date()
                    }
                },
                { upsert: true }
            );

            // Store token metadata in MongoDB for refresh logic
            await this.tokens.updateOne(
                { email },
                {
                    $set: {
                        access_token: tokens.access_token || '',
                        refresh_token: tokens.refresh_token || '',
                        expiry_date: tokens.expiry_date || 0,
                        scope: tokens.scope || '',
                        token_type: tokens.token_type || 'Bearer',
                        updated_at: new Date(),
                    }
                },
                { upsert: true }
            );

            // Initialize preferences
            await this.preferences.updateOne(
                { email },
                {
                    $setOnInsert: {
                        email,
                        timezone: 'UTC',
                        language: 'en',
                        notification_enabled: true,
                    }
                },
                { upsert: true }
            );

            return { email, name: name || '' };
        } catch (error: any) {
            console.error(chalk.red('[UserManager] Google callback failed:'), error.message);
            return null;
        }
    }

    /**
     * Get or create authenticated Google client for user
     */
    async getUserAuthClient(phoneNumber: string): Promise<OAuth2Client | null> {
        // Check if user is registered
        if (!(await this.isUserRegistered(phoneNumber))) {
            return null;
        }

        // Check if we already have a cached client that's still fresh
        const cached = this.userAuthClients.get(phoneNumber);
        if (cached) {
            const cacheAge = Date.now() - cached.cachedAt;
            if (cacheAge < UserManager.AUTH_CACHE_TTL_MS) {
                // Cache is fresh, use it directly
                await this.updateLastActive(phoneNumber);
                return cached.client;
            }
            // Cache is stale — re-validate by re-initializing below
            console.log(chalk.yellow(`   ⚠  Auth cache expired for ${phoneNumber}, re-validating...`));
            this.userAuthClients.delete(phoneNumber);
        }

        try {
            const tokenPath = this.getUserTokenPath(phoneNumber);

            // Token file doesn't exist — try hydrating from DB using email as primary key
            if (!fs.existsSync(tokenPath)) {
                // Bridge: look up the email linked to this phone number
                const userDoc = await this.users.findOne({ phone_number: phoneNumber });
                const emailKey = userDoc?.email;
                const storedToken = emailKey
                    ? await this.tokens.findOne({ email: emailKey })
                    : await this.tokens.findOne({ phone_number: phoneNumber }); // fallback
                if (storedToken) {
                    const dir = path.dirname(tokenPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                    const googleTokens = {
                        access_token: storedToken.access_token,
                        refresh_token: storedToken.refresh_token,
                        scope: storedToken.scope,
                        token_type: storedToken.token_type || 'Bearer',
                        expiry_date: storedToken.expiry_date
                    };

                    fs.writeFileSync(tokenPath, JSON.stringify(googleTokens, null, 2));
                }
            }

            // Create new auth manager for this user
            const authManager = new GoogleAuthManager(tokenPath);

            // Wire callback: whenever tokens are refreshed, sync back to MongoDB
            authManager.onTokenRefresh(async (refreshedTokens: GoogleTokens) => {
                await this.syncTokensToDb(phoneNumber, refreshedTokens);
            });

            // Try initializing without interactive fallback first (background process)
            const success = await authManager.initialize(true);

            if (!success) {
                console.log(chalk.red(`   ✖ Auth failed for ${phoneNumber} — refresh token expired (invalid_grant)`));
                console.log(chalk.yellow(`   → Resetting user to allow re-registration via /register`));

                // Clean up stale tokens and reset user status
                await this.resetUserAuth(phoneNumber);
                // Also invalidate any cached tool registry
                this.invalidateToolRegistry(phoneNumber);
                return null;
            }

            const client = authManager.getClient();

            // Cache the client with timestamp
            this.userAuthClients.set(phoneNumber, { client, authManager, cachedAt: Date.now() });

            // Update last active
            await this.updateLastActive(phoneNumber);

            return client;
        } catch (error) {
            console.error(chalk.red(`   ✖ Failed to get auth client for ${phoneNumber}:`), error);
            return null;
        }
    }

    /**
     * Sync refreshed Google tokens back to MongoDB (called by auth manager callback)
     * Uses email as the primary key (matching how handleGoogleCallback stores them).
     */
    private async syncTokensToDb(phoneNumber: string, tokens: GoogleTokens): Promise<void> {
        try {
            // Prefer email key — tokens are stored by email from the OAuth callback
            const userDoc = await this.users.findOne({ phone_number: phoneNumber });
            const filter = userDoc?.email ? { email: userDoc.email } : { phone_number: phoneNumber };

            await this.tokens.updateOne(
                filter,
                {
                    $set: {
                        access_token: tokens.access_token || '',
                        refresh_token: tokens.refresh_token || '',
                        expiry_date: tokens.expiry_date || 0,
                        scope: tokens.scope || '',
                        token_type: tokens.token_type || 'Bearer',
                        updated_at: new Date(),
                    }
                },
                { upsert: true }
            );
            console.log(chalk.gray(`   ▸ Tokens synced to MongoDB for ${userDoc?.email || phoneNumber}`));
        } catch (error) {
            console.error(chalk.red(`   ✖ Failed to sync tokens to MongoDB for ${phoneNumber}:`), error);
        }
    }

    /**
     * Background worker that runs periodically to proactively refresh expiring Google tokens
     */
    private startTokenRefreshWorker(): void {
        if (this.refreshWorkerInterval) {
            clearInterval(this.refreshWorkerInterval);
        }

        console.log(chalk.gray(`   ▸ Starting background token refresh worker (every ${UserManager.REFRESH_WORKER_INTERVAL_MS / 60000}m)`));

        this.refreshWorkerInterval = setInterval(async () => {
            try {
                // Find all tokens that actually have a refresh_token
                const allTokens = await this.tokens.find({ 
                    refresh_token: { $exists: true, $ne: '' } 
                }).toArray();

                const now = Date.now();
                const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh if expiring within 5 minutes
                let refreshedCount = 0;

                for (const tokenDoc of allTokens) {
                    // Check if token map explicitly lacks expiry (0) or is expiring soon
                    const isExpiring = !tokenDoc.expiry_date || tokenDoc.expiry_date < (now + REFRESH_BUFFER_MS);
                    if (!isExpiring) continue;

                    // Resolve phone number — tokens may be stored by email (web OAuth) with no phone_number field
                    let phoneNumber = tokenDoc.phone_number;
                    if (!phoneNumber && tokenDoc.email) {
                        const userDoc = await this.users.findOne({ email: tokenDoc.email });
                        phoneNumber = userDoc?.phone_number;
                    }

                    if (phoneNumber) {
                        try {
                            const authClient = await this.getUserAuthClient(phoneNumber);
                            if (authClient) refreshedCount++;
                        } catch (err) {
                            console.error(chalk.yellow(`   ⚠ Background refresh failed for ${phoneNumber}`));
                        }
                    }
                }
                
                if (refreshedCount > 0) {
                    console.log(chalk.green(`   ✓ Background worker refreshed ${refreshedCount} expiring Google tokens`));
                }
            } catch (error) {
                console.error(chalk.red('   ✖ Background token refresh worker error:'), error);
            }
        }, UserManager.REFRESH_WORKER_INTERVAL_MS);
    }

    /**
     * Invalidate cached tool registry for a user (called when auth changes)
     * This is a no-op here — AgentCore should call this or listen for auth changes
     */
    invalidateToolRegistry(phoneNumber: string): void {
        // Remove cached auth client so it gets re-created next time
        this.userAuthClients.delete(phoneNumber);
        console.log(chalk.gray(`   ▸ Auth cache invalidated for ${phoneNumber}`));
    }

    /**
     * Reset user's auth state when refresh tokens are expired/revoked.
     * This allows them to re-register via /register without manual DB cleanup.
     */
    async resetUserAuth(phoneNumber: string): Promise<void> {
        // Remove cached client
        this.userAuthClients.delete(phoneNumber);

        // Delete stale token file
        const tokenPath = this.getUserTokenPath(phoneNumber);
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
            console.log(chalk.gray(`   ▸ Deleted stale token file for ${phoneNumber}`));
        }

        // Delete tokens from DB — try both email and phone_number keys
        const userDoc = await this.users.findOne({ phone_number: phoneNumber });
        if (userDoc?.email) {
            await this.tokens.deleteOne({ email: userDoc.email });
        }
        await this.tokens.deleteOne({ phone_number: phoneNumber });

        // Reset registration status to 'pending' so /register works
        await this.users.updateOne(
            { phone_number: phoneNumber },
            { $set: { registration_status: 'pending' } }
        );

        console.log(chalk.yellow(`   ▸ User ${phoneNumber} reset to pending — they can re-register with /register`));
    }

    /**
     * Store user OAuth tokens in MongoDB
     */
    private async storeUserTokens(phoneNumber: string, client: OAuth2Client): Promise<void> {
        const credentials = client.credentials;

        await this.tokens.updateOne(
            { phone_number: phoneNumber },
            {
                $set: {
                    phone_number: phoneNumber,
                    access_token: credentials.access_token || '',
                    refresh_token: credentials.refresh_token || '',
                    expiry_date: credentials.expiry_date || 0,
                    scope: credentials.scope || '',
                    token_type: credentials.token_type || 'Bearer',
                    updated_at: new Date(),
                }
            },
            { upsert: true }
        );
    }

    /**
     * Revoke user access and delete their data
     */
    async revokeUser(phoneNumber: string): Promise<boolean> {
        try {
            // Revoke Google tokens
            const authClient = await this.getUserAuthClient(phoneNumber);
            if (authClient) {
                await authClient.revokeCredentials();
            }

            // Remove from cache
            this.userAuthClients.delete(phoneNumber);

            // Delete from database
            await this.users.deleteOne({ phone_number: phoneNumber });
            await this.tokens.deleteOne({ phone_number: phoneNumber });
            await this.preferences.deleteOne({ phone_number: phoneNumber });

            // Delete token file
            const tokenPath = this.getUserTokenPath(phoneNumber);
            if (fs.existsSync(tokenPath)) {
                fs.unlinkSync(tokenPath);
            }

            console.log(chalk.yellow(`   ⚠ User revoked: ${phoneNumber}`));
            return true;
        } catch (error) {
            console.error(chalk.red('   ✖ Revoke failed:'), error);
            return false;
        }
    }

    /**
     * Update user's last active timestamp
     */
    private async updateLastActive(phoneNumber: string): Promise<void> {
        await this.users.updateOne(
            { phone_number: phoneNumber },
            { $set: { last_active: new Date() } }
        );
    }

    /**
     * Get user-specific token file path
     */
    private getUserTokenPath(phoneNumber: string): string {
        // Sanitize phone number for filename
        const sanitized = phoneNumber.replace(/[^0-9]/g, '');
        const tokensDir = path.join('./data/tokens');

        // Ensure directory exists
        if (!fs.existsSync(tokensDir)) {
            fs.mkdirSync(tokensDir, { recursive: true });
        }

        return path.join(tokensDir, `token_${sanitized}.json`);
    }

    /**
     * Clean up old pending registrations (>30 minutes)
     */
    private cleanupPendingRegistrations(): void {
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
        for (const [phone, data] of this.pendingRegistrations.entries()) {
            if (data.timestamp < thirtyMinutesAgo) {
                this.pendingRegistrations.delete(phone);
            }
        }
    }

    /**
     * Get all active users
     */
    async getAllUsers(): Promise<User[]> {
        return await this.users
            .find({ is_active: true, registration_status: 'completed' })
            .sort({ last_active: -1 })
            .toArray();
    }

    /**
     * Get user statistics
     */
    async getUserStats(): Promise<{ total: number; active_today: number; active_week: number; pending: number }> {
        const total = await this.users.countDocuments({
            is_active: true,
            registration_status: 'completed'
        });

        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activeToday = await this.users.countDocuments({
            is_active: true,
            registration_status: 'completed',
            last_active: { $gte: dayAgo }
        });

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const activeWeek = await this.users.countDocuments({
            is_active: true,
            registration_status: 'completed',
            last_active: { $gte: weekAgo }
        });

        const pending = await this.users.countDocuments({
            registration_status: 'pending'
        });

        return { total, active_today: activeToday, active_week: activeWeek, pending };
    }

    /**
     * Get user preferences
     */
    async getUserPreferences(phoneNumber: string): Promise<UserPreferences | null> {
        return await this.preferences.findOne({ phone_number: phoneNumber });
    }

    /**
     * Update user preferences
     */
    async updateUserPreferences(phoneNumber: string, prefs: Partial<UserPreferences>): Promise<boolean> {
        try {
            await this.preferences.updateOne(
                { phone_number: phoneNumber },
                { $set: prefs },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.error(chalk.red('   ✖ Failed to update preferences:'), error);
            return false;
        }
    }



    /**
     * Link a WhatsApp phone number to a user's email account
     */
    async linkPhoneNumberToEmail(email: string, phoneNumber: string): Promise<boolean> {
        try {
            await this.users.updateOne(
                { email },
                { $set: { phone_number: phoneNumber } }
            );
            return true;
        } catch (error) {
            console.error(chalk.red('[UserManager] Failed to link phone number:'), error);
            return false;
        }
    }

    /**
     * Cleanup and close database connection
     */
    async shutdown(): Promise<void> {
        if (this.refreshWorkerInterval) {
            clearInterval(this.refreshWorkerInterval);
            this.refreshWorkerInterval = null;
        }

        if (this.isConnected) {
            await this.client.close();
            console.log(chalk.gray('   ▸ MongoDB connection closed'));
        }
    }


    // ==========================================
    // MULTI-TENANT WEB API KEYS (Via Dashboard)
    // ==========================================

    /**
     * Store custom encrypted API keys for a user.
     */
    async saveApiKeys(email: string, manusKey?: string, v0Key?: string): Promise<boolean> {
        try {
            const updates: Partial<User> = {};
            if (manusKey !== undefined) updates.manus_api_key = encryptText(manusKey);
            if (v0Key !== undefined) updates.v0_api_key = encryptText(v0Key);

            await this.users.updateOne(
                { email },
                { $set: updates }
            );
            return true;
        } catch (error) {
            console.error(chalk.red(`   ✖ Failed to save API keys for ${email}`), error);
            return false;
        }
    }

    /**
     * Retrieve decrypted API keys for a user.
     * Guaranteed to return objects even if missing/empty to avoid crashes.
     */
    async getApiKeys(email: string): Promise<{ manusKey: string, v0Key: string }> {
        const user = await this.users.findOne({ email });
        if (!user) return { manusKey: '', v0Key: '' };

        return {
            manusKey: user.manus_api_key ? decryptText(user.manus_api_key) : '',
            v0Key: user.v0_api_key ? decryptText(user.v0_api_key) : ''
        };
    }
}

