import { google, docs_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getDocsClient(auth: OAuth2Client): docs_v1.Docs {
    return google.docs({ version: 'v1', auth });
}

/**
 * Industrial-grade Google Docs tools with batch update operations,
 * advanced formatting, named ranges, table support, and comprehensive
 * document manipulation capabilities based on 2024 API best practices.
 */
export function createDocsTools(auth: OAuth2Client): ToolDefinition[] {
    const docs = getDocsClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // DOCUMENT READING & MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'docs_get_content',
            description: 'Retrieves full document content with structure (headings, lists, tables) and metadata.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    include_structure: {
                        type: 'boolean',
                        description: 'Optional: Include structural info (headings, lists, tables). Default false.'
                    },
                },
                required: ['document_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const doc = await docs.documents.get({
                        documentId: params.document_id,
                    });

                    const title = doc.data.title || 'Untitled';
                    const body = doc.data.body;
                    const documentStyle = doc.data.documentStyle;

                    // Extract plain text
                    let text = '';
                    let structureInfo = '';

                    if (body?.content) {
                        for (const element of body.content) {
                            if (element.paragraph) {
                                const para = element.paragraph;
                                const paraElements = para.elements || [];

                                for (const elem of paraElements) {
                                    if (elem.textRun?.content) {
                                        text += elem.textRun.content;
                                    }
                                }

                                // Extract structure if requested
                                if (params.include_structure && para.paragraphStyle?.namedStyleType) {
                                    const style = para.paragraphStyle.namedStyleType;
                                    if (style.startsWith('HEADING')) {
                                        const headingText = paraElements
                                            .map(e => e.textRun?.content || '')
                                            .join('')
                                            .trim();
                                        if (headingText) {
                                            structureInfo += `\n${style}: ${headingText}`;
                                        }
                                    }
                                }
                            } else if (element.table && params.include_structure) {
                                const rows = element.table.rows;
                                const rowCount = Array.isArray(rows) ? rows.length : 0;
                                structureInfo += `\n📊 TABLE (${rowCount} rows)`;
                            } else if (element.tableOfContents && params.include_structure) {
                                structureInfo += '\n📑 TABLE OF CONTENTS';
                            }
                        }
                    }

                    const preview = text.substring(0, 800) + (text.length > 800 ? '...' : '');
                    const pageCount = documentStyle?.pageSize ? 'Multiple pages' : 'Single page';

                    let message = `📄 **${title}**\n\n`;
                    message += `**Metadata:**\n`;
                    message += `• Length: ${text.length} characters\n`;
                    message += `• Format: ${pageCount}\n`;
                    message += `• Revision ID: ${doc.data.revisionId}\n\n`;

                    if (structureInfo) {
                        message += `**Document Structure:**${structureInfo}\n\n`;
                    }

                    message += `**Content Preview:**\n${preview}`;

                    return {
                        success: true,
                        data: {
                            title,
                            content: text,
                            documentId: params.document_id,
                            revisionId: doc.data.revisionId,
                            structure: structureInfo
                        },
                        message,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to read document: ${error.message}\n\n💡 Verify document ID and permissions.`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // DOCUMENT CREATION & MODIFICATION
        // ═══════════════════════════════════════════════════════════

        {
            name: 'docs_create_document',
            description: 'Creates a new Google Doc with optional initial content and formatting.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'The title of the new document.' },
                    content: { type: 'string', description: 'Optional: Initial text content for the document.' },
                    add_title_heading: {
                        type: 'boolean',
                        description: 'Optional: Add title as HEADING_1. Default false.'
                    },
                },
                required: ['title'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Create the document
                    const doc = await docs.documents.create({
                        requestBody: {
                            title: params.title,
                        },
                    });

                    const docId = doc.data.documentId!;
                    const requests: docs_v1.Schema$Request[] = [];

                    // Add title as heading if requested
                    if (params.add_title_heading) {
                        requests.push({
                            insertText: {
                                location: { index: 1 },
                                text: `${params.title}\n\n`,
                            },
                        });
                        requests.push({
                            updateParagraphStyle: {
                                range: {
                                    startIndex: 1,
                                    endIndex: params.title.length + 1,
                                },
                                paragraphStyle: {
                                    namedStyleType: 'HEADING_1',
                                },
                                fields: 'namedStyleType',
                            },
                        });
                    }

                    // Add content if provided
                    if (params.content) {
                        const insertIndex = params.add_title_heading ? params.title.length + 3 : 1;
                        requests.push({
                            insertText: {
                                location: { index: insertIndex },
                                text: params.content,
                            },
                        });
                    }

                    // Execute batch update if there are any requests
                    if (requests.length > 0) {
                        await docs.documents.batchUpdate({
                            documentId: docId,
                            requestBody: { requests },
                        });
                    }

                    return {
                        success: true,
                        data: { documentId: docId, title: params.title },
                        message: `📄 Document "${params.title}" created successfully!\n\n` +
                            `ID: \`${docId}\`\n` +
                            `🔗 https://docs.google.com/document/d/${docId}/edit\n\n` +
                            `${params.content ? `Added ${params.content.length} characters of content.` : 'Document is ready for editing.'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create document: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_append_text',
            description: 'Appends text to the end of a document with optional styling.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    text: { type: 'string', description: 'The text to append.' },
                    style: {
                        type: 'string',
                        enum: ['NORMAL_TEXT', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'],
                        description: 'Optional: Paragraph style for the appended text.'
                    },
                },
                required: ['document_id', 'text'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Get current document to find end index
                    const doc = await docs.documents.get({
                        documentId: params.document_id,
                    });

                    const content = doc.data.body?.content || [];
                    const endIndex = content[content.length - 1]?.endIndex || 1;

                    const requests: docs_v1.Schema$Request[] = [
                        {
                            insertText: {
                                location: { index: endIndex - 1 },
                                text: params.text,
                            },
                        },
                    ];

                    // Apply style if specified
                    if (params.style && params.style !== 'NORMAL_TEXT') {
                        requests.push({
                            updateParagraphStyle: {
                                range: {
                                    startIndex: endIndex - 1,
                                    endIndex: endIndex - 1 + params.text.length,
                                },
                                paragraphStyle: {
                                    namedStyleType: params.style,
                                },
                                fields: 'namedStyleType',
                            },
                        });
                    }

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: { requests },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id, addedLength: params.text.length },
                        message: `📄 Text appended to document.\n` +
                            `Added ${params.text.length} characters` +
                            `${params.style ? ` with style: ${params.style}` : ''}.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to append text: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_insert_text',
            description: 'Inserts text at a specific position in the document.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    text: { type: 'string', description: 'The text to insert.' },
                    index: { type: 'integer', description: 'The character index where to insert (1 = beginning).' },
                },
                required: ['document_id', 'text', 'index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    insertText: {
                                        location: { index: params.index },
                                        text: params.text,
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📄 Text inserted at position ${params.index}.\nAdded ${params.text.length} characters.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to insert text: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_replace_text',
            description: 'Replaces all occurrences of a text pattern in a document with support for case sensitivity.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    find: { type: 'string', description: 'The text to find.' },
                    replace: { type: 'string', description: 'The text to replace it with.' },
                    match_case: { type: 'boolean', description: 'Optional: Case-sensitive matching. Default false.' },
                },
                required: ['document_id', 'find', 'replace'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    replaceAllText: {
                                        containsText: {
                                            text: params.find,
                                            matchCase: params.match_case || false,
                                        },
                                        replaceText: params.replace,
                                    },
                                },
                            ],
                        },
                    });

                    const occurrences = result.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

                    return {
                        success: true,
                        data: { documentId: params.document_id, occurrences },
                        message: `📄 Replaced ${occurrences} occurrence(s) of "${params.find}" with "${params.replace}".`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to replace text: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_delete_range',
            description: 'Deletes content within a specific range in the document.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    start_index: { type: 'integer', description: 'The starting index of content to delete.' },
                    end_index: { type: 'integer', description: 'The ending index of content to delete.' },
                },
                required: ['document_id', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    deleteContentRange: {
                                        range: {
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                    },
                                },
                            ],
                        },
                    });

                    const deletedChars = params.end_index - params.start_index;

                    return {
                        success: true,
                        data: { documentId: params.document_id, deletedLength: deletedChars },
                        message: `📄 Deleted ${deletedChars} characters (index ${params.start_index} to ${params.end_index}).`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete content: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FORMATTING & STYLING (BATCH OPERATIONS)
        // ═══════════════════════════════════════════════════════════

        {
            name: 'docs_format_text',
            description: 'Applies text formatting (bold, italic, underline, color, font) to a range using batch update.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    start_index: { type: 'integer', description: 'The starting index of text to format.' },
                    end_index: { type: 'integer', description: 'The ending index of text to format.' },
                    bold: { type: 'boolean', description: 'Optional: Apply bold formatting.' },
                    italic: { type: 'boolean', description: 'Optional: Apply italic formatting.' },
                    underline: { type: 'boolean', description: 'Optional: Apply underline formatting.' },
                    font_size: { type: 'integer', description: 'Optional: Font size in points.' },
                    font_family: { type: 'string', description: 'Optional: Font family (e.g., "Arial", "Times New Roman").' },
                    foreground_color: {
                        type: 'object',
                        description: 'Optional: Text color as RGB object {red: 0-1, green: 0-1, blue: 0-1}.',
                        properties: {
                            red: { type: 'number' },
                            green: { type: 'number' },
                            blue: { type: 'number' },
                        },
                    },
                },
                required: ['document_id', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const textStyle: docs_v1.Schema$TextStyle = {};
                    const fields: string[] = [];

                    if (params.bold !== undefined) {
                        textStyle.bold = params.bold;
                        fields.push('bold');
                    }
                    if (params.italic !== undefined) {
                        textStyle.italic = params.italic;
                        fields.push('italic');
                    }
                    if (params.underline !== undefined) {
                        textStyle.underline = params.underline;
                        fields.push('underline');
                    }
                    if (params.font_size) {
                        textStyle.fontSize = { magnitude: params.font_size, unit: 'PT' };
                        fields.push('fontSize');
                    }
                    if (params.font_family) {
                        textStyle.weightedFontFamily = { fontFamily: params.font_family };
                        fields.push('weightedFontFamily');
                    }
                    if (params.foreground_color) {
                        textStyle.foregroundColor = {
                            color: {
                                rgbColor: params.foreground_color,
                            },
                        };
                        fields.push('foregroundColor');
                    }

                    if (fields.length === 0) {
                        return { success: false, message: '⚠️ No formatting options specified.' };
                    }

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    updateTextStyle: {
                                        range: {
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                        textStyle,
                                        fields: fields.join(','),
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📄 Formatting applied successfully!\n` +
                            `Range: ${params.start_index} to ${params.end_index}\n` +
                            `Applied: ${fields.join(', ')}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to format text: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_apply_paragraph_style',
            description: 'Applies paragraph-level styling (headings, alignment, spacing, indentation).',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    start_index: { type: 'integer', description: 'The starting index of the paragraph.' },
                    end_index: { type: 'integer', description: 'The ending index of the paragraph.' },
                    named_style: {
                        type: 'string',
                        enum: ['NORMAL_TEXT', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6', 'TITLE', 'SUBTITLE'],
                        description: 'Optional: Named paragraph style.'
                    },
                    alignment: {
                        type: 'string',
                        enum: ['START', 'CENTER', 'END', 'JUSTIFIED'],
                        description: 'Optional: Text alignment.'
                    },
                    line_spacing: { type: 'integer', description: 'Optional: Line spacing percentage (100 = single, 200 = double).' },
                    indent_start: { type: 'number', description: 'Optional: Left indent in points.' },
                },
                required: ['document_id', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
                    const fields: string[] = [];

                    if (params.named_style) {
                        paragraphStyle.namedStyleType = params.named_style;
                        fields.push('namedStyleType');
                    }
                    if (params.alignment) {
                        paragraphStyle.alignment = params.alignment;
                        fields.push('alignment');
                    }
                    if (params.line_spacing) {
                        paragraphStyle.lineSpacing = params.line_spacing;
                        fields.push('lineSpacing');
                    }
                    if (params.indent_start !== undefined) {
                        paragraphStyle.indentStart = { magnitude: params.indent_start, unit: 'PT' };
                        fields.push('indentStart');
                    }

                    if (fields.length === 0) {
                        return { success: false, message: '⚠️ No paragraph style options specified.' };
                    }

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    updateParagraphStyle: {
                                        range: {
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                        paragraphStyle,
                                        fields: fields.join(','),
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📄 Paragraph style applied successfully!\n` +
                            `Applied: ${fields.join(', ')}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to apply paragraph style: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // ADVANCED FEATURES (IMAGES, TABLES, LISTS)
        // ═══════════════════════════════════════════════════════════

        {
            name: 'docs_insert_image',
            description: 'Inserts an image from a public URL at a specific position with size options.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    image_url: { type: 'string', description: 'The public URL of the image.' },
                    index: { type: 'integer', description: 'Position to insert image. Use 1 for beginning, or get from document.' },
                    width_pts: { type: 'number', description: 'Optional: Image width in points.' },
                    height_pts: { type: 'number', description: 'Optional: Image height in points.' },
                },
                required: ['document_id', 'image_url'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const insertIndex = params.index || 1;
                    const requests: docs_v1.Schema$Request[] = [];

                    const imageRequest: docs_v1.Schema$Request = {
                        insertInlineImage: {
                            location: { index: insertIndex },
                            uri: params.image_url,
                        },
                    };

                    // Add size if specified
                    if (params.width_pts || params.height_pts) {
                        imageRequest.insertInlineImage!.objectSize = {
                            width: params.width_pts ? { magnitude: params.width_pts, unit: 'PT' } : undefined,
                            height: params.height_pts ? { magnitude: params.height_pts, unit: 'PT' } : undefined,
                        };
                    }

                    requests.push(imageRequest);

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: { requests },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📄 Image inserted successfully at position ${insertIndex}.\n` +
                            `${params.width_pts || params.height_pts ? `Size: ${params.width_pts || 'auto'} x ${params.height_pts || 'auto'} pts` : 'Default size'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to insert image: ${error.message}\n\n💡 Ensure image URL is publicly accessible.`
                    };
                }
            },
        },

        {
            name: 'docs_insert_table',
            description: 'Inserts a table with specified dimensions at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    rows: { type: 'integer', description: 'Number of rows in the table.' },
                    columns: { type: 'integer', description: 'Number of columns in the table.' },
                    index: { type: 'integer', description: 'Position to insert table. Use 1 for beginning.' },
                },
                required: ['document_id', 'rows', 'columns'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const insertIndex = params.index || 1;

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    insertTable: {
                                        location: { index: insertIndex },
                                        rows: params.rows,
                                        columns: params.columns,
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📊 Table inserted successfully!\n` +
                            `Dimensions: ${params.rows} rows × ${params.columns} columns\n` +
                            `Position: ${insertIndex}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to insert table: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_create_bulleted_list',
            description: 'Converts a range of paragraphs into a bulleted or numbered list.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    start_index: { type: 'integer', description: 'Starting index of the range.' },
                    end_index: { type: 'integer', description: 'Ending index of the range.' },
                    glyph_type: {
                        type: 'string',
                        enum: ['DECIMAL', 'ALPHA', 'ROMAN', 'DISC', 'CIRCLE', 'SQUARE'],
                        description: 'Optional: List glyph type. Default DISC (bullet).'
                    },
                },
                required: ['document_id', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const glyphType = params.glyph_type || 'DISC';

                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    createParagraphBullets: {
                                        range: {
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                        bulletPreset: glyphType === 'DECIMAL' || glyphType === 'ALPHA' || glyphType === 'ROMAN'
                                            ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
                                            : 'BULLET_DISC_CIRCLE_SQUARE',
                                    },
                                },
                            ],
                        },
                    });

                    const listType = ['DECIMAL', 'ALPHA', 'ROMAN'].includes(glyphType) ? 'numbered' : 'bulleted';

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📝 Created ${listType} list successfully!\n` +
                            `Range: ${params.start_index} to ${params.end_index}\n` +
                            `Style: ${glyphType}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create list: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'docs_insert_page_break',
            description: 'Inserts a page break at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    index: { type: 'integer', description: 'Position to insert page break.' },
                },
                required: ['document_id', 'index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    insertPageBreak: {
                                        location: { index: params.index },
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: { documentId: params.document_id },
                        message: `📄 Page break inserted at position ${params.index}.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to insert page break: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // NAMED RANGES (BOOKMARKS)
        // ═══════════════════════════════════════════════════════════

        {
            name: 'docs_create_named_range',
            description: 'Creates a named range (bookmark) for easy reference and programmatic access.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: { type: 'string', description: 'The ID of the Google Doc.' },
                    name: { type: 'string', description: 'Name for this range (alphanumeric and underscores only).' },
                    start_index: { type: 'integer', description: 'Starting index of the range.' },
                    end_index: { type: 'integer', description: 'Ending index of the range.' },
                },
                required: ['document_id', 'name', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await docs.documents.batchUpdate({
                        documentId: params.document_id,
                        requestBody: {
                            requests: [
                                {
                                    createNamedRange: {
                                        name: params.name,
                                        range: {
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                    },
                                },
                            ],
                        },
                    });

                    const namedRangeId = result.data.replies?.[0]?.createNamedRange?.namedRangeId;

                    return {
                        success: true,
                        data: { documentId: params.document_id, namedRangeId },
                        message: `🔖 Named range "${params.name}" created successfully!\n` +
                            `Range ID: \`${namedRangeId}\`\n` +
                            `Scope: ${params.start_index} to ${params.end_index}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create named range: ${error.message}`
                    };
                }
            },
        },
    ];
}
