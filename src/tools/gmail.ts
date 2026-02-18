import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
    return google.gmail({ version: 'v1', auth });
}

/**
 * Creates a raw RFC 2822 formatted email for sending via Gmail API
 */
function createRawEmail(
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string,
    isHtml?: boolean,
    attachments?: Array<{ filename: string; content: string; mimeType: string }>
): string {
    const boundary = '----=_Part_' + Date.now();
    let email = [
        `To: ${to}`,
        cc ? `Cc: ${cc}` : '',
        bcc ? `Bcc: ${bcc}` : '',
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
    ].filter(Boolean).join('\r\n');

    if (attachments && attachments.length > 0) {
        email += `\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
        email += `--${boundary}\r\n`;
        email += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8\r\n\r\n`;
        email += `${body}\r\n\r\n`;

        for (const att of attachments) {
            email += `--${boundary}\r\n`;
            email += `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n`;
            email += `Content-Transfer-Encoding: base64\r\n`;
            email += `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n`;
            email += `${att.content}\r\n\r\n`;
        }
        email += `--${boundary}--`;
    } else {
        email += `\r\nContent-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8\r\n\r\n`;
        email += body;
    }

    return Buffer.from(email).toString('base64url');
}

/**
 * Industrial-grade Gmail tools with batch operations, advanced filtering,
 * label management, and draft/thread support based on 2024 API best practices.
 */
export function createGmailTools(auth: OAuth2Client): ToolDefinition[] {
    const gmail = getGmailClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // EMAIL SENDING & DRAFTS
        // ═══════════════════════════════════════════════════════════

        {
            name: 'gmail_send_email',
            description: 'Sends an email with advanced options (CC, BCC, HTML body, attachments).',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Recipient email address.' },
                    subject: { type: 'string', description: 'Email subject.' },
                    body: { type: 'string', description: 'Email body content.' },
                    cc: { type: 'string', description: 'Optional: CC recipients (comma-separated).' },
                    bcc: { type: 'string', description: 'Optional: BCC recipients (comma-separated).' },
                    is_html: { type: 'boolean', description: 'Optional: Send as HTML email. Default false.' },
                    thread_id: { type: 'string', description: 'Optional: Thread ID to reply to (maintains conversation).' },
                },
                required: ['to', 'subject', 'body'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const raw = createRawEmail(
                        params.to,
                        params.subject,
                        params.body,
                        params.cc,
                        params.bcc,
                        params.is_html
                    );

                    const result = await gmail.users.messages.send({
                        userId: 'me',
                        requestBody: {
                            raw,
                            threadId: params.thread_id,
                        },
                    });

                    return {
                        success: true,
                        data: { messageId: result.data.id, threadId: result.data.threadId },
                        message: `📧 Email sent successfully!\n` +
                            `To: ${params.to}\n` +
                            `Subject: ${params.subject}\n` +
                            `Message ID: \`${result.data.id}\`\n` +
                            `${params.thread_id ? `Thread: \`${result.data.threadId}\`` : 'New conversation'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to send email: ${error.message}\n\n💡 Check recipient address and permissions.`,
                    };
                }
            },
        },

        {
            name: 'gmail_create_draft',
            description: 'Creates an email draft with advanced options for later sending.',
            parameters: {
                type: 'object',
                properties: {
                    to: { type: 'string', description: 'Recipient email address.' },
                    subject: { type: 'string', description: 'Email subject.' },
                    body: { type: 'string', description: 'Email body content.' },
                    cc: { type: 'string', description: 'Optional: CC recipients.' },
                    bcc: { type: 'string', description: 'Optional: BCC recipients.' },
                    is_html: { type: 'boolean', description: 'Optional: HTML content. Default false.' },
                },
                required: ['to', 'subject', 'body'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const raw = createRawEmail(
                        params.to,
                        params.subject,
                        params.body,
                        params.cc,
                        params.bcc,
                        params.is_html
                    );

                    const result = await gmail.users.drafts.create({
                        userId: 'me',
                        requestBody: {
                            message: { raw },
                        },
                    });

                    return {
                        success: true,
                        data: { draftId: result.data.id, messageId: result.data.message?.id },
                        message: `📝 Draft created successfully!\n` +
                            `To: ${params.to}\n` +
                            `Subject: ${params.subject}\n` +
                            `Draft ID: \`${result.data.id}\``,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create draft: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_send_draft',
            description: 'Sends a previously created draft email.',
            parameters: {
                type: 'object',
                properties: {
                    draft_id: { type: 'string', description: 'The ID of the draft to send.' },
                },
                required: ['draft_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.drafts.send({
                        userId: 'me',
                        requestBody: {
                            id: params.draft_id,
                        },
                    });

                    return {
                        success: true,
                        data: { messageId: result.data.id, threadId: result.data.threadId },
                        message: `📧 Draft sent successfully!\n` +
                            `Message ID: \`${result.data.id}\`\n` +
                            `Thread: \`${result.data.threadId}\``,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to send draft: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // EMAIL READING & SEARCHING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'gmail_list_messages',
            description: 'Lists messages with advanced filtering using Gmail search syntax.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Optional: Gmail search query (e.g., "is:unread from:user@example.com after:2024/01/01").',
                    },
                    label_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Filter by label IDs (e.g., ["INBOX", "UNREAD"]).',
                    },
                    max_results: { type: 'integer', description: 'Optional: Max messages to return (1-500). Default 10.' },
                    include_spam_trash: { type: 'boolean', description: 'Optional: Include spam and trash. Default false.' },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.messages.list({
                        userId: 'me',
                        q: params.query,
                        labelIds: params.label_ids,
                        maxResults: Math.min(params.max_results || 10, 500),
                        includeSpamTrash: params.include_spam_trash || false,
                    });

                    const messages = result.data.messages || [];
                    if (messages.length === 0) {
                        return { success: true, data: [], message: '📭 No messages found matching criteria.' };
                    }

                    // Fetch details for first few messages to show preview
                    const previews = await Promise.all(
                        messages.slice(0, 5).map(async (msg) => {
                            const detail = await gmail.users.messages.get({
                                userId: 'me',
                                id: msg.id!,
                                format: 'metadata',
                                metadataHeaders: ['From', 'Subject', 'Date'],
                            });
                            const headers = detail.data.payload?.headers || [];
                            const getHeader = (name: string) =>
                                headers.find((h) => h.name === name)?.value || 'N/A';
                            return {
                                id: msg.id,
                                from: getHeader('From'),
                                subject: getHeader('Subject'),
                                date: getHeader('Date'),
                            };
                        })
                    );

                    const formatted = previews
                        .map(
                            (p, i) =>
                                `${i + 1}. **${p.subject}**\n` +
                                `   From: ${p.from}\n` +
                                `   Date: ${p.date}\n` +
                                `   ID: \`${p.id}\``
                        )
                        .join('\n\n');

                    return {
                        success: true,
                        data: messages.map((m) => ({ id: m.id, threadId: m.threadId })),
                        message: `📬 Found ${messages.length} message(s)${messages.length > 5 ? ` (showing first 5)` : ''}:\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list messages: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_get_message',
            description: 'Gets full message details including headers and body with format options.',
            parameters: {
                type: 'object',
                properties: {
                    message_id: { type: 'string', description: 'The ID of the message.' },
                    format: {
                        type: 'string',
                        enum: ['minimal', 'full', 'raw', 'metadata'],
                        description: 'Optional: Response format. Default "full".',
                    },
                },
                required: ['message_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.messages.get({
                        userId: 'me',
                        id: params.message_id,
                        format: (params.format as any) || 'full',
                    });

                    const headers = result.data.payload?.headers || [];
                    const getHeader = (name: string) => headers.find((h) => h.name === name)?.value || 'N/A';

                    // Extract body
                    let body = '';
                    if (result.data.payload?.body?.data) {
                        body = Buffer.from(result.data.payload.body.data, 'base64').toString('utf-8');
                    } else if (result.data.payload?.parts) {
                        const textPart = result.data.payload.parts.find(
                            (p) => p.mimeType === 'text/plain' || p.mimeType === 'text/html'
                        );
                        if (textPart?.body?.data) {
                            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
                        }
                    }

                    const preview = body.substring(0, 500) + (body.length > 500 ? '...' : '');

                    return {
                        success: true,
                        data: {
                            id: result.data.id,
                            threadId: result.data.threadId,
                            labels: result.data.labelIds,
                            snippet: result.data.snippet,
                            from: getHeader('From'),
                            to: getHeader('To'),
                            subject: getHeader('Subject'),
                            date: getHeader('Date'),
                            body: body,
                        },
                        message: `📧 **${getHeader('Subject')}**\n\n` +
                            `From: ${getHeader('From')}\n` +
                            `To: ${getHeader('To')}\n` +
                            `Date: ${getHeader('Date')}\n` +
                            `Labels: ${result.data.labelIds?.join(', ') || 'None'}\n\n` +
                            `**Body Preview:**\n${preview}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get message: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_get_thread',
            description: 'Gets an entire email thread/conversation with all messages.',
            parameters: {
                type: 'object',
                properties: {
                    thread_id: { type: 'string', description: 'The ID of the thread.' },
                    format: {
                        type: 'string',
                        enum: ['minimal', 'full', 'metadata'],
                        description: 'Optional: Message format. Default "metadata".',
                    },
                },
                required: ['thread_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.threads.get({
                        userId: 'me',
                        id: params.thread_id,
                        format: (params.format as any) || 'metadata',
                    });

                    const messages = result.data.messages || [];
                    const formatted = messages
                        .map((msg, i) => {
                            const headers = msg.payload?.headers || [];
                            const getHeader = (name: string) => headers.find((h) => h.name === name)?.value || 'N/A';
                            return (
                                `${i + 1}. **${getHeader('Subject')}**\n` +
                                `   From: ${getHeader('From')}\n` +
                                `   Date: ${getHeader('Date')}\n` +
                                `   Snippet: ${msg.snippet}\n` +
                                `   Message ID: \`${msg.id}\``
                            );
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: {
                            threadId: result.data.id,
                            messageCount: messages.length,
                            messages: messages.map((m) => ({
                                id: m.id,
                                snippet: m.snippet,
                                labelIds: m.labelIds,
                            })),
                        },
                        message: `📨 Thread with ${messages.length} message(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get thread: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // MESSAGE MANAGEMENT (BATCH OPERATIONS)
        // ═══════════════════════════════════════════════════════════

        {
            name: 'gmail_modify_messages',
            description: 'Modifies multiple messages in batch (add/remove labels, mark read/unread, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    message_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of message IDs to modify (max 50 per batch).',
                    },
                    add_label_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Labels to add (e.g., ["STARRED", "IMPORTANT"]).',
                    },
                    remove_label_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Labels to remove (e.g., ["UNREAD", "INBOX"]).',
                    },
                },
                required: ['message_ids'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    if (params.message_ids.length > 50) {
                        return {
                            success: false,
                            message: '⚠️ Batch limit is 50 messages. Please reduce the number of message IDs.',
                        };
                    }

                    await gmail.users.messages.batchModify({
                        userId: 'me',
                        requestBody: {
                            ids: params.message_ids,
                            addLabelIds: params.add_label_ids,
                            removeLabelIds: params.remove_label_ids,
                        },
                    });

                    const actions: string[] = [];
                    if (params.add_label_ids?.length) {
                        actions.push(`Added labels: ${params.add_label_ids.join(', ')}`);
                    }
                    if (params.remove_label_ids?.length) {
                        actions.push(`Removed labels: ${params.remove_label_ids.join(', ')}`);
                    }

                    return {
                        success: true,
                        data: { modifiedCount: params.message_ids.length },
                        message: `✅ Modified ${params.message_ids.length} message(s)!\n${actions.join('\n')}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to modify messages: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_batch_delete',
            description: 'Permanently deletes multiple messages in batch (bypasses trash).',
            parameters: {
                type: 'object',
                properties: {
                    message_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of message IDs to delete (max 1000 per batch).',
                    },
                },
                required: ['message_ids'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    if (params.message_ids.length > 1000) {
                        return {
                            success: false,
                            message: '⚠️ Batch limit is 1000 messages. Please reduce the number of message IDs.',
                        };
                    }

                    await gmail.users.messages.batchDelete({
                        userId: 'me',
                        requestBody: {
                            ids: params.message_ids,
                        },
                    });

                    return {
                        success: true,
                        data: { deletedCount: params.message_ids.length },
                        message: `🗑️ Permanently deleted ${params.message_ids.length} message(s).`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete messages: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_trash_message',
            description: 'Moves a message to trash (recoverable).',
            parameters: {
                type: 'object',
                properties: {
                    message_id: { type: 'string', description: 'The ID of the message to trash.' },
                },
                required: ['message_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await gmail.users.messages.trash({
                        userId: 'me',
                        id: params.message_id,
                    });

                    return {
                        success: true,
                        data: { messageId: params.message_id },
                        message: `🗑️ Message moved to trash (recoverable within 30 days).`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to trash message: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // LABEL MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'gmail_list_labels',
            description: 'Lists all labels (folders) in the mailbox.',
            parameters: {
                type: 'object',
                properties: {},
            },
            execute: async (): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.labels.list({
                        userId: 'me',
                    });

                    const labels = result.data.labels || [];
                    const systemLabels = labels.filter((l) => l.type === 'system');
                    const userLabels = labels.filter((l) => l.type === 'user');

                    const formatted = [
                        ...systemLabels.map((l) => `📌 ${l.name} (${l.id})`),
                        userLabels.length > 0 ? '\n**User Labels:**' : '',
                        ...userLabels.map((l) => `🏷️ ${l.name} (${l.id})`),
                    ]
                        .filter(Boolean)
                        .join('\n');

                    return {
                        success: true,
                        data: labels.map((l) => ({ id: l.id, name: l.name, type: l.type })),
                        message: `🏷️ Found ${labels.length} label(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list labels: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_create_label',
            description: 'Creates a new custom label with visibility options.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name of the new label.' },
                    label_list_visibility: {
                        type: 'string',
                        enum: ['labelShow', 'labelShowIfUnread', 'labelHide'],
                        description: 'Optional: Visibility in label list. Default "labelShow".',
                    },
                    message_list_visibility: {
                        type: 'string',
                        enum: ['show', 'hide'],
                        description: 'Optional: Show in message list. Default "show".',
                    },
                },
                required: ['name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.labels.create({
                        userId: 'me',
                        requestBody: {
                            name: params.name,
                            labelListVisibility: params.label_list_visibility || 'labelShow',
                            messageListVisibility: params.message_list_visibility || 'show',
                        },
                    });

                    return {
                        success: true,
                        data: { labelId: result.data.id, name: result.data.name },
                        message: `🏷️ Label "${params.name}" created successfully!\nLabel ID: \`${result.data.id}\``,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create label: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_delete_label',
            description: 'Deletes a custom label (cannot delete system labels).',
            parameters: {
                type: 'object',
                properties: {
                    label_id: { type: 'string', description: 'The ID of the label to delete.' },
                },
                required: ['label_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await gmail.users.labels.delete({
                        userId: 'me',
                        id: params.label_id,
                    });

                    return {
                        success: true,
                        data: { labelId: params.label_id },
                        message: `🗑️ Label deleted successfully.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete label: ${error.message}\n\n💡 System labels cannot be deleted.`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FILTERS & AUTOMATION
        // ═══════════════════════════════════════════════════════════

        {
            name: 'gmail_create_filter',
            description: 'Creates an email filter with criteria and actions (auto-labeling, forwarding, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'Optional: Filter emails from this address.' },
                    to: { type: 'string', description: 'Optional: Filter emails to this address.' },
                    subject: { type: 'string', description: 'Optional: Filter by subject keywords.' },
                    query: { type: 'string', description: 'Optional: Advanced Gmail search query.' },
                    add_label_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Labels to apply.',
                    },
                    remove_label_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Labels to remove (e.g., ["INBOX"] for archiving).',
                    },
                    forward: { type: 'string', description: 'Optional: Forward to this address.' },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const criteria: any = {};
                    if (params.from) criteria.from = params.from;
                    if (params.to) criteria.to = params.to;
                    if (params.subject) criteria.subject = params.subject;
                    if (params.query) criteria.query = params.query;

                    const action: any = {};
                    if (params.add_label_ids) action.addLabelIds = params.add_label_ids;
                    if (params.remove_label_ids) action.removeLabelIds = params.remove_label_ids;
                    if (params.forward) action.forward = params.forward;

                    const result = await gmail.users.settings.filters.create({
                        userId: 'me',
                        requestBody: {
                            criteria,
                            action,
                        },
                    });

                    return {
                        success: true,
                        data: { filterId: result.data.id },
                        message: `🔍 Filter created successfully!\nFilter ID: \`${result.data.id}\``,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create filter: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'gmail_list_filters',
            description: 'Lists all email filters configured in the mailbox.',
            parameters: {
                type: 'object',
                properties: {},
            },
            execute: async (): Promise<ToolResult> => {
                try {
                    const result = await gmail.users.settings.filters.list({
                        userId: 'me',
                    });

                    const filters = result.data.filter || [];
                    if (filters.length === 0) {
                        return { success: true, data: [], message: '🔍 No filters configured.' };
                    }

                    const formatted = filters
                        .map((f, i) => {
                            const criteriaStr = Object.entries(f.criteria || {})
                                .filter(([_, v]) => v)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(', ');
                            const actionStr = Object.entries(f.action || {})
                                .filter(([_, v]) => v)
                                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                                .join(', ');
                            return `${i + 1}. **Filter \`${f.id}\`**\n   Criteria: ${criteriaStr}\n   Action: ${actionStr}`;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: filters,
                        message: `🔍 Found ${filters.length} filter(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list filters: ${error.message}`,
                    };
                }
            },
        },
    ];
}