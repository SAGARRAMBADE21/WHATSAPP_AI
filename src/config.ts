import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
        tokenPath: path.resolve(process.env.GOOGLE_TOKEN_PATH || './auth/google_tokens.json'),
        scopes: [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
        ],
    },
    whatsapp: {
        allowedNumbers: (process.env.ALLOWED_NUMBERS || '').split(',').filter(Boolean),
        ownerNumber: process.env.OWNER_NUMBER || '',
        authStatePath: process.env.AUTH_STATE_PATH || './auth/baileys_auth',
    },
    memory: {
        dbPath: process.env.MEMORY_DB_PATH || './data/memory/navigator.db',
        shortTermMaxTurns: 10,
        longTermMaxEntries: 1000,
    },
    logLevel: process.env.LOG_LEVEL || 'info',
} as const;