import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getDriveClient(auth: OAuth2Client): drive_v3.Drive {
    return google.drive({ version: 'v3', auth });
}

export function createDriveTools(auth: OAuth2Client): ToolDefinition[] {
    const drive = getDriveClient(auth);

    return [
        // ── drive_search_files ──
        {
            name: 'drive_search_files',
            description: 'Searches for files and folders in Google Drive.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: "Search query using Drive API query syntax (e.g., \"name contains 'report'\")." },
                    file_type: { type: 'string', description: 'Optional: Filter by type — document, spreadsheet, pdf, folder, presentation.' },
                    max_results: { type: 'integer', description: 'Optional: Maximum number of results. Default 10.' },
                },
                required: ['query'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    let q = params.query;

                    // Auto-map friendly file_type to mimeType
                    const mimeMap: Record<string, string> = {
                        document: 'application/vnd.google-apps.document',
                        spreadsheet: 'application/vnd.google-apps.spreadsheet',
                        presentation: 'application/vnd.google-apps.presentation',
                        pdf: 'application/pdf',
                        folder: 'application/vnd.google-apps.folder',
                    };
                    if (params.file_type && mimeMap[params.file_type]) {
                        q += ` and mimeType = '${mimeMap[params.file_type]}'`;
                    }

                    const result = await drive.files.list({
                        q,
                        pageSize: params.max_results || 10,
                        fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
                    });

                    const files = result.data.files || [];
                    if (files.length === 0) {
                        return { success: true, data: [], message: `🔍 No files found for query: "${params.query}"` };
                    }

                    const formatted = files
                        .map((f, i) => `${i + 1}. **${f.name}** (${f.mimeType})\n   Modified: ${f.modifiedTime}\n   ID: \`${f.id}\``)
                        .join('\n');

                    return {
                        success: true,
                        data: files,
                        message: `📁 Found ${files.length} file(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Drive search failed: ${error.message}` };
                }
            },
        },

        // ── drive_create_folder ──
        {
            name: 'drive_create_folder',
            description: 'Creates a new folder in Google Drive.',
            parameters: {
                type: 'object',
                properties: {
                    folder_name: { type: 'string', description: 'The name of the new folder.' },
                    parent_id: { type: 'string', description: 'Optional: The ID of the parent folder.' },
                },
                required: ['folder_name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const metadata: drive_v3.Schema$File = {
                        name: params.folder_name,
                        mimeType: 'application/vnd.google-apps.folder',
                    };
                    if (params.parent_id) metadata.parents = [params.parent_id];

                    const result = await drive.files.create({
                        requestBody: metadata,
                        fields: 'id, name, webViewLink',
                    });

                    return {
                        success: true,
                        data: { folderId: result.data.id, name: result.data.name },
                        message: `📁 Folder "${params.folder_name}" created successfully.\nID: \`${result.data.id}\``,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to create folder: ${error.message}` };
                }
            },
        },

        // ── drive_copy_file ──
        {
            name: 'drive_copy_file',
            description: 'Copies an existing file in Google Drive.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file to copy.' },
                    new_name: { type: 'string', description: 'Optional: New name for the copy.' },
                    parent_id: { type: 'string', description: 'Optional: Destination folder ID.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const metadata: drive_v3.Schema$File = {};
                    if (params.new_name) metadata.name = params.new_name;
                    if (params.parent_id) metadata.parents = [params.parent_id];

                    const result = await drive.files.copy({
                        fileId: params.file_id,
                        requestBody: metadata,
                        fields: 'id, name',
                    });

                    return {
                        success: true,
                        data: { fileId: result.data.id, name: result.data.name },
                        message: `📋 File copied: "${result.data.name}"\nNew ID: \`${result.data.id}\``,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to copy file: ${error.message}` };
                }
            },
        },

        // ── drive_move_file ──
        {
            name: 'drive_move_file',
            description: 'Moves a file to a different folder in Google Drive.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file to move.' },
                    destination_folder_id: { type: 'string', description: 'The ID of the destination folder.' },
                },
                required: ['file_id', 'destination_folder_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Get current parents
                    const file = await drive.files.get({ fileId: params.file_id, fields: 'parents' });
                    const previousParents = (file.data.parents || []).join(',');

                    const result = await drive.files.update({
                        fileId: params.file_id,
                        addParents: params.destination_folder_id,
                        removeParents: previousParents,
                        fields: 'id, name, parents',
                    });

                    return {
                        success: true,
                        data: { fileId: result.data.id },
                        message: `📁 File "${result.data.name}" moved successfully.`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to move file: ${error.message}` };
                }
            },
        },

        // ── drive_delete_file ──
        {
            name: 'drive_delete_file',
            description: 'Moves a file or folder to trash in Google Drive.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: { type: 'string', description: 'The ID of the file or folder to delete.' },
                },
                required: ['file_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await drive.files.update({
                        fileId: params.file_id,
                        requestBody: { trashed: true },
                    });
                    return { success: true, message: `🗑️ File ${params.file_id} moved to trash.` };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to delete file: ${error.message}` };
                }
            },
        },
    ];
}