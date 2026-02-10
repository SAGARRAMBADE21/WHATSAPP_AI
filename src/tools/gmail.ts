import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult, ExecutionContext } from '../types';

function getGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
    return google.gmail({ version: 'v1', auth });
}

function createRawEmail(to: string, subject: string, body: string, cc?: string, bcc?: string): string {
    const lines = [
        `To: ${to}`,
        cc ? `Cc: ${cc}` : '',
        bcc ? `Bcc: ${bcc}` : '',
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        body,
    ].filter(Boolean);

    const raw = lines.join('\r\n');
    return Buffer.from(raw).toString('base64url');
}

export function createGmailTools(auth: OAuth2Client): ToolDefinition[] {
    const gmail = getGmailClient(auth);

    return [
        // ── gmail_send_email ──
        {
            name: 'gmail_send_email',
            description: 'Sends an email to one or more recipients.',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Comma-separated list of recipient email addresses.' },
                    subject: { type: 'string', description: 'The subject line of the email.' },
                    body: { type: 'string', description: 'The main content of the email.' },
                    cc: { type: 'string', description: 'Optional: Comma-separated list of CC recipients.' },
                    bcc: { type: 'string', description: 'Optional: Comma-separated list of BCC recipients.' },
                },
                required: ['to', 'subject', 'body'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const raw = createRawEmail(params.to, params.subject, params.body, params.cc, params.bcc);
                    const result = await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: { raw },
                    });
                    return {
                        success: true,
                        data: { messageId: result.data.id, threadId: result.data.threadId },
                        message: `✅ Email sent successfully to ${params.to}. Subject: "${params.subject}"`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to send email: ${error.message}` };
                }
            },
        },

        // ── gmail_create_draft ──
        {
            name: 'gmail_create_draft',
            description: 'Creates a draft email.',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Comma-separated list of recipient email addresses.' },
                    subject: { type: 'string', description: 'The subject line of the email.' },
                    body: { type: 'string', description: 'The main content of the email.' },
                    cc: { type: 'string', description: 'Optional: Comma-separated CC recipients.' },
                    bcc: { type: 'string', description: 'Optional: Comma-separated BCC recipients.' },
                },
                required: ['to', 'subject', 'body'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const raw = createRawEmail(params.to, params.subject, params.body, params.cc, params.bcc);
                    const result = await gmail.users.drafts.create({
                        userId: 'me',
                        requestBody: { message: { raw } },
                    });
                    return {
                        success: true,
                        data: { draftId: result.data.id },
                        message: `✅ Draft created. Subject: "${params.subject}" → To: ${params.to}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to create draft: ${error.message}` };
                }
            },
        },

        // ── gmail_read_email ──
        {
            name: 'gmail_read_email',
            description: 'Reads the content of a specific email by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: { type: 'string', description: 'The unique ID of the email to read.' },
                },
                required: ['email_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.messages.get({
                        userId: 'me',
                        id: params.email_id,
                        format: 'full',
                    });

                    const headers = result.data.payload?.headers || [];
                    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

                    let body = '';
                    const payload = result.data.payload;
                    if (payload?.body?.data) {
                        body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
                    } else if (payload?.parts) {
                        const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
                        if (textPart?.body?.data) {
                            body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
                        }
                    }

                    const emailData = {
                        id: result.data.id,
                        from: getHeader('From'),
                        to: getHeader('To'),
                        subject: getHeader('Subject'),
                        date: getHeader('Date'),
                        body: body.substring(0, 2000), // Truncate for readability
                        snippet: result.data.snippet,
                    };

                    return {
                        success: true,
                        data: emailData,
                        message: `📧 **From:** ${emailData.from}\n**Subject:** ${emailData.subject}\n**Date:** ${emailData.date}\n\n${emailData.body.substring(0, 500)}${emailData.body.length > 500 ? '...' : ''}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to read email: ${error.message}` };
                }
            },
        },

        // ── gmail_search_email ──
        {
            name: 'gmail_search_email',
            description: 'Searches for emails based on various criteria using Gmail search syntax.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: "The search query (e.g., 'from:alice subject:report')." },
                    max_results: { type: 'integer', description: 'Optional: Maximum number of results. Default 10.' },
                },
                required: ['query'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.messages.list({
                        userId: 'me',
                        q: params.query,
                        maxResults: params.max_results || 10,
                    });

                    const messages = result.data.messages || [];
                    if (messages.length === 0) {
                        return { success: true, data: [], message: `🔍 No emails found for query: "${params.query}"` };
                    }

                    const summaries = await Promise.all(
                        messages.slice(0, 5).map(async (m) => {
                            const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
                            const headers = msg.data.payload?.headers || [];
                            const getH = (n: string) => headers.find((h) => h.name === n)?.value || '';
                            return { id: m.id, from: getH('From'), subject: getH('Subject'), date: getH('Date'), snippet: msg.data.snippet };
                        })
                    );

                    const formatted = summaries
                        .map((s, i) => `${i + 1}. **${s.subject}** — from ${s.from} (${s.date})\n   ID: \`${s.id}\``)
                        .join('\n');

                    return {
                        success: true,
                        data: summaries,
                        message: `🔍 Found ${messages.length} email(s). Top results:\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Search failed: ${error.message}` };
                }
            },
        },

        // ── gmail_delete_email ──
        {
            name: 'gmail_delete_email',
            description: 'Moves an email to trash by its ID.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: { type: 'string', description: 'The unique ID of the email to delete.' },
                },
                required: ['email_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await gmail.users.messages.trash({ userId: 'me', id: params.email_id });
                    return { success: true, message: `🗑️ Email ${params.email_id} moved to trash.` };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to delete: ${error.message}` };
                }
            },
        },

        // ── gmail_add_label ──
        {
            name: 'gmail_add_label',
            description: 'Adds a label to an email.',
            parameters: {
                type: 'object',
                properties: {
                    email_id: { type: 'string', description: 'The unique ID of the email.' },
                    label_name: { type: 'string', description: 'The name of the label to add.' },
                },
                required: ['email_id', 'label_name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Find or create label
                    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
                    let label = labelsRes.data.labels?.find(
                        (l) => l.name?.toLowerCase() === params.label_name.toLowerCase()
                    );

                    if (!label) {
                        const created = await gmail.users.labels.create({
                            userId: 'me',
                            requestBody: { name: params.label_name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
                        });
                        label = created.data;
                    }

                    await gmail.users.messages.modify({
                        userId: 'me',
                        id: params.email_id,
                        requestBody: { addLabelIds: [label.id!] },
                    });

                    return { success: true, message: `🏷️ Label "${params.label_name}" added to email ${params.email_id}.` };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to add label: ${error.message}` };
                }
            },
        },
    ];
}