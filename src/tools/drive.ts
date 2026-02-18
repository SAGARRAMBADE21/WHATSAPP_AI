import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getDriveClient(auth: OAuth2Client): drive_v3.Drive {
    return google.drive({ version: 'v3', auth });
}

/**
 * Industrial-grade Google Drive tools with batch operations, advanced search,
 * permissions management, file sharing, and version control based on 2024 API best practices.
 */
export function createDriveTools(auth: OAuth2Client): ToolDefinition[] {
    const drive = getDriveClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // FILE SEARCH & LISTING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'drive_search_files',
            description: 'Searches for files and folders with advanced filtering using Drive query syntax.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Optional: Search query (e.g., "name contains \'report\' and mimeType = \'application/pdf\'").',
                    },
                    folder_id: { type: 'string', description: 'Optional: Search within specific folder ID.' },
                    mime_type: { type: 'string', description: 'Optional: Filter by MIME type.' },
                    trashed: { type: 'boolean', description: 'Optional: Include trashed files. Default false.' },
                    max_results: { type: 'integer', description: 'Optional: Max results (1-1000). Default  20.' },
                    order_by: {
                        type: 'string',
                        description: 'Optional: Sort order (e.g., "modifiedTime desc", "name", "createdTime").',
                    },
                    fields: {
                        type: 'string',
                        description: 'Optional: Fields to include (partial response for efficiency). Default "*".',
                    },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    let q = params.query || '';

                    // Build query
                    if (params.folder_id) {
                        q += (q ? ' and ' : '') + `'${params.folder_id}' in parents`;
                    }
                    if (params.mime_type) {
                        q += (q ? ' and ' : '') + `mimeType = '${params.mime_type}'`;
                    }
                    if (!params.trashed) {
                        q += (q ? ' and ' : '') + 'trashed = false';
                    }

                    const result = await drive.files.list({
                        q: q || undefined,
                        pageSize: Math.min(params.max_results || 20, 1000),
                        orderBy: params.order_by,
                        fields: params.fields || 'files(id, name, mimeType, size, createdTime, modifiedTime, owners, webViewLink)',
                    });

                    const files = result.data.files || [];
                    if (files.length === 0) {
                        return { success: true, data: [], message: '📁 No files found matching criteria.' };
                    }

                    const formatted = files
                        .map((f, i) => {
                            const type = f.mimeType?.includes('folder') ? '📁' : '📄';
                            const size = f.size ? `${(parseInt(f.size) / 1024).toFixed(2)} KB` : 'N/A';
                            const owner = f.owners?.[0]?.displayName || 'Unknown';
                            return (
                                `${i + 1}. ${type} **${f.name}**\n` +
                                `   Type: ${f.mimeType}\n` +
                                `   Size: ${size}\n` +
                                `   Owner: ${owner}\n` +
                                `   Modified: ${f.modifiedTime}\n` +
                                `   ID: \`${f.id}\`\n` +
                                `   Link: ${f.webViewLink || 'N/A'}`
                            );
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: files,
                        message: `📁 Found ${files.length} file(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to search files: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_get_file_metadata',
            description: 'Gets detailed metadata for a specific file with custom field selection.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file.' },
                    fields: {
                        type: 'string',
                        description: 'Optional: Specific fields to retrieve (e.g., "id,name,size,permissions"). Default "*".',
                    },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await drive.files.get({
                        fileId: params.file_id,
                        fields: params.fields || '*',
                    });

                    const file = result.data;
                    const size = file.size ? `${(parseInt(file.size) / 1024).toFixed(2)} KB` : 'N/A';
                    const type = file.mimeType?.includes('folder') ? '📁 Folder' : '📄 File';

                    return {
                        success: true,
                        data: file,
                        message: `${type}: **${file.name}**\n\n` +
                            `ID: \`${file.id}\`\n` +
                            `Type: ${file.mimeType}\n` +
                            `Size: ${size}\n` +
                            `Created: ${file.createdTime}\n` +
                            `Modified: ${file.modifiedTime}\n` +
                            `Owner: ${file.owners?.[0]?.displayName || 'Unknown'}\n` +
                            `Link: ${file.webViewLink || 'N/A'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get file metadata: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FILE & FOLDER CREATION
        // ═══════════════════════════════════════════════════════════

        {
            name: 'drive_create_folder',
            description: 'Creates a new folder with optional parent location.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name of the new folder.' },
                    parent_folder_id: { type: 'string', description: 'Optional: Parent folder ID. Default: My Drive root.' },
                    description: { type: 'string', description: 'Optional: Folder description.' },
                },
                required: ['name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const fileMetadata: drive_v3.Schema$File = {
                        name: params.name,
                        mimeType: 'application/vnd.google-apps.folder',
                        description: params.description,
                    };

                    if (params.parent_folder_id) {
                        fileMetadata.parents = [params.parent_folder_id];
                    }

                    const result = await drive.files.create({
                        requestBody: fileMetadata,
                        fields: 'id, name, webViewLink',
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📁 Folder "${params.name}" created successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Link: ${result.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create folder: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_upload_file',
            description: 'Uploads a file to Google Drive with metadata.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name for the file in Drive.' },
                    mime_type: { type: 'string', description: 'MIME type of the file (e.g., "text/plain", "image/png").' },
                    content: { type: 'string', description: 'File content (for text files) or base64 encoded data.' },
                    parent_folder_id: { type: 'string', description: 'Optional: Parent folder ID.' },
                    description: { type: 'string', description: 'Optional: File description.' },
                },
                required: ['name', 'mime_type', 'content'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const fileMetadata: drive_v3.Schema$File = {
                        name: params.name,
                        description: params.description,
                    };

                    if (params.parent_folder_id) {
                        fileMetadata.parents = [params.parent_folder_id];
                    }

                    const media = {
                        mimeType: params.mime_type,
                        body: params.content,
                    };

                    const result = await drive.files.create({
                        requestBody: fileMetadata,
                        media: media as any,
                        fields: 'id, name, size, webViewLink',
                    });

                    const size = result.data.size ? `${(parseInt(result.data.size) / 1024).toFixed(2)} KB` : 'N/A';

                    return {
                        success: true,
                        data: result.data,
                        message: `📄 File "${params.name}" uploaded successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Size: ${size}\n` +
                            `Link: ${result.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to upload file: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FILE OPERATIONS
        // ═══════════════════════════════════════════════════════════

        {
            name: 'drive_copy_file',
            description: 'Creates a copy of a file with a new name and optional location.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file to copy.' },
                    new_name: { type: 'string', description: 'Name for the copied file.' },
                    parent_folder_id: { type: 'string', description: 'Optional: Destination folder ID.' },
                },
                required: ['file_id', 'new_name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const fileMetadata: drive_v3.Schema$File = {
                        name: params.new_name,
                    };

                    if (params.parent_folder_id) {
                        fileMetadata.parents = [params.parent_folder_id];
                    }

                    const result = await drive.files.copy({
                        fileId: params.file_id,
                        requestBody: fileMetadata,
                        fields: 'id, name, webViewLink',
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📄 File copied successfully!\n` +
                            `New name: ${params.new_name}\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Link: ${result.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to copy file: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_move_file',
            description: 'Moves a file to a different folder.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file to move.' },
                    target_folder_id: { type: 'string', description: 'The ID of the destination folder.' },
                },
                required: ['file_id', 'target_folder_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Get current parents
                    const file = await drive.files.get({
                        fileId: params.file_id,
                        fields: 'parents, name',
                    });

                    const previousParents = file.data.parents?.join(',');

                    // Move file
                    const result = await drive.files.update({
                        fileId: params.file_id,
                        addParents: params.target_folder_id,
                        removeParents: previousParents,
                        fields: 'id, name, parents, webViewLink',
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📄 File "${result.data.name}" moved successfully!\n` +
                            `New location: \`${params.target_folder_id}\`\n` +
                            `Link: ${result.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to move file: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_rename_file',
            description: 'Renames a file or folder.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder to rename.' },
                    new_name: { type: 'string', description: 'The new name.' },
                },
                required: ['file_id', 'new_name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await drive.files.update({
                        fileId: params.file_id,
                        requestBody: {
                            name: params.new_name,
                        },
                        fields: 'id, name, mimeType, webViewLink',
                    });

                    const type = result.data.mimeType?.includes('folder') ? 'Folder' : 'File';

                    return {
                        success: true,
                        data: result.data,
                        message: `${type} renamed to "${params.new_name}" successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Link: ${result.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to rename: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_delete_file',
            description: 'Permanently deletes a file or folder (bypasses trash).',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder to delete.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await drive.files.delete({
                        fileId: params.file_id,
                    });

                    return {
                        success: true,
                        data: { fileId: params.file_id },
                        message: `🗑️ File permanently deleted.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete file: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_trash_file',
            description: 'Moves a file to trash (recoverable).',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder to trash.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await drive.files.update({
                        fileId: params.file_id,
                        requestBody: {
                            trashed: true,
                        },
                        fields: 'id, name',
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `🗑️ "${result.data.name}" moved to trash (recoverable).`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to trash file: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // PERMISSIONS & SHARING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'drive_share_file',
            description: 'Shares a file/folder with specific users or makes it publicly accessible.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder to share.' },
                    email: { type: 'string', description: 'Optional: Email address to share with (for user/group sharing).' },
                    role: {
                        type: 'string',
                        enum: ['reader', 'writer', 'commenter', 'owner'],
                        description: 'Role to grant. Default "reader".',
                    },
                    type: {
                        type: 'string',
                        enum: ['user', 'group', 'domain', 'anyone'],
                        description: 'Permission type. Default "user" if email provided, otherwise "anyone".',
                    },
                    send_notification: { type: 'boolean', description: 'Optional: Send email notification. Default true.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const permission: drive_v3.Schema$Permission = {
                        type: params.type || (params.email ? 'user' : 'anyone'),
                        role: params.role || 'reader',
                    };

                    if (params.email && permission.type !== 'anyone') {
                        permission.emailAddress = params.email;
                    }

                    const result = await drive.permissions.create({
                        fileId: params.file_id,
                        requestBody: permission,
                        sendNotificationEmail: params.send_notification !== false,
                        fields: 'id, type, role, emailAddress',
                    });

                    // Get shareable link
                    const file = await drive.files.get({
                        fileId: params.file_id,
                        fields: 'webViewLink, name',
                    });

                    return {
                        success: true,
                        data: { permission: result.data, link: file.data.webViewLink },
                        message: `🔗 "${file.data.name}" shared successfully!\n` +
                            `Permission: ${result.data.type} - ${result.data.role}\n` +
                            `${result.data.emailAddress ? `Shared with: ${result.data.emailAddress}\n` : ''}` +
                            `Link: ${file.data.webViewLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to share file: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_list_permissions',
            description: 'Lists all permissions (sharing settings) for a file/folder.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await drive.permissions.list({
                        fileId: params.file_id,
                        fields: 'permissions(id, type, role, emailAddress, displayName)',
                    });

                    const permissions = result.data.permissions || [];
                    if (permissions.length === 0) {
                        return { success: true, data: [], message: '🔒 No permissions found (private file).' };
                    }

                    const formatted = permissions
                        .map((p, i) => {
                            const user = p.emailAddress || p.displayName || p.type;
                            return `${i + 1}. ${user} - **${p.role}** (${p.type})\n   Permission ID: \`${p.id}\``;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: permissions,
                        message: `🔗 Found ${permissions.length} permission(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list permissions: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'drive_remove_permission',
            description: 'Removes a specific permission from a file/folder.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file/folder.' },
                    permission_id: { type: 'string', description: 'The ID of the permission to remove.' },
                },
                required: ['file_id', 'permission_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await drive.permissions.delete({
                        fileId: params.file_id,
                        permissionId: params.permission_id,
                    });

                    return {
                        success: true,
                        data: { permissionId: params.permission_id },
                        message: `🔒 Permission removed successfully.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to remove permission: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // ADVANCED FEATURES
        // ═══════════════════════════════════════════════════════════

        {
            name: 'drive_export_file',
            description: 'Exports Google Workspace files (Docs, Sheets, Slides) to various formats.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the Google Workspace file to export.' },
                    mime_type: {
                        type: 'string',
                        description: 'Export MIME type (e.g., "application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").',
                    },
                },
                required: ['file_id', 'mime_type'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await drive.files.export({
                        fileId: params.file_id,
                        mimeType: params.mime_type,
                    }, {
                        responseType: 'text',
                    });

                    // Get file name
                    const file = await drive.files.get({
                        fileId: params.file_id,
                        fields: 'name',
                    });

                    return {
                        success: true,
                        data: { content: result.data, fileName: file.data.name },
                        message: `📥 File "${file.data.name}" exported successfully!\n` +
                            `Format: ${params.mime_type}\n` +
                            `Size: ${JSON.stringify(result.data).length} bytes`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to export file: ${error.message}\n\n💡 Ensure file is a Google Workspace document.`,
                    };
                }
            },
        },

        {
            name: 'drive_get_storage_quota',
            description: 'Gets information about Drive storage usage and quota.',
            parameters: {
                type: 'object',
                properties: {},
            },
            execute: async (): Promise<ToolResult> => {
                try {
                    const result = await drive.about.get({
                        fields: 'storageQuota, user',
                    });

                    const quota = result.data.storageQuota;
                    const limit = quota?.limit ? parseInt(quota.limit) : 0;
                    const usage = quota?.usage ? parseInt(quota.usage) : 0;
                    const usageInDrive = quota?.usageInDrive ? parseInt(quota.usageInDrive) : 0;
                    const usageInTrash = quota?.usageInDriveTrash ? parseInt(quota.usageInDriveTrash) : 0;

                    const formatBytes = (bytes: number) => {
                        const gb = bytes / (1024 ** 3);
                        return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / (1024 ** 2)).toFixed(2)} MB`;
                    };

                    const percentage = limit > 0 ? ((usage / limit) * 100).toFixed(2) : '0';

                    return {
                        success: true,
                        data: quota,
                        message: `💾 **Storage Quota**\n\n` +
                            `Total Usage: ${formatBytes(usage)} (${percentage}%)\n` +
                            `Limit: ${formatBytes(limit)}\n` +
                            `In Drive: ${formatBytes(usageInDrive)}\n` +
                            `In Trash: ${formatBytes(usageInTrash)}\n` +
                            `Available: ${formatBytes(limit - usage)}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get storage quota: ${error.message}`,
                    };
                }
            },
        },
    ];
}