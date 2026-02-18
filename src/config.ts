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
            'openid',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.compose',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/classroom.courses.readonly',
            'https://www.googleapis.com/auth/classroom.rosters.readonly',
            'https://www.googleapis.com/auth/classroom.coursework.students',
            'https://www.googleapis.com/auth/classroom.announcements',
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
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
        dbName: process.env.MONGODB_DB_NAME || 'workspace_navigator',
    },
    logLevel: process.env.LOG_LEVEL || 'info',
} as const;