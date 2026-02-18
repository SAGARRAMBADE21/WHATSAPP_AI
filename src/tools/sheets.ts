import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getSheetsClient(auth: OAuth2Client): sheets_v4.Sheets {
    return google.sheets({ version: 'v4', auth });
}

/**
 * Industrial-grade Google Sheets tools with batch update operations,
 * conditional formatting, formulas, data validation, and advanced spreadsheet
 * manipulation based on 2024 API v4 best practices.
 */
export function createSheetsTools(auth: OAuth2Client): ToolDefinition[] {
    const sheets = getSheetsClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // SPREADSHEET & SHEET MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'sheets_create_spreadsheet',
            description: 'Creates a new spreadsheet with optional initial sheets and properties.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Title of the new spreadsheet.' },
                    sheet_titles: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Array of initial sheet names. Default: ["Sheet1"].',
                    },
                },
                required: ['title'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const sheets_data: sheets_v4.Schema$Sheet[] = (params.sheet_titles || ['Sheet1']).map((title: string) => ({
                        properties: { title },
                    }));

                    const result = await sheets.spreadsheets.create({
                        requestBody: {
                            properties: {
                                title: params.title,
                            },
                            sheets: sheets_data,
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Spreadsheet "${params.title}" created successfully!\n` +
                            `ID: \`${result.data.spreadsheetId}\`\n` +
                            `Sheets: ${params.sheet_titles?.join(', ') || 'Sheet1'}\n` +
                            `Link: ${result.data.spreadsheetUrl}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create spreadsheet: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_get_spreadsheet',
            description: 'Gets spreadsheet metadata and sheet information.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    include_grid_data: { type: 'boolean', description: 'Optional: Include cell data. Default false.' },
                },
                required: ['spreadsheet_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.get({
                        spreadsheetId: params.spreadsheet_id,
                        includeGridData: params.include_grid_data || false,
                    });

                    const spreadsheet = result.data;
                    const sheetsList = spreadsheet.sheets
                        ?.map((s, i) => {
                            const props = s.properties!;
                            return `${i + 1}. **${props.title}** (ID: ${props.sheetId}, ${props.gridProperties?.rowCount} rows × ${props.gridProperties?.columnCount} cols)`;
                        })
                        .join('\n') || 'None';

                    return {
                        success: true,
                        data: spreadsheet,
                        message: `📊 **${spreadsheet.properties?.title}**\n\n` +
                            `ID: \`${spreadsheet.spreadsheetId}\`\n` +
                            `Sheets (${spreadsheet.sheets?.length || 0}):\n${sheetsList}\n\n` +
                            `Link: ${spreadsheet.spreadsheetUrl}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get spreadsheet: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_add_sheet',
            description: 'Adds a new sheet to an existing spreadsheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    title: { type: 'string', description: 'Title for the new sheet.' },
                    row_count: { type: 'integer', description: 'Optional: Initial row count. Default 1000.' },
                    column_count: { type: 'integer', description: 'Optional: Initial column count. Default 26.' },
                    index: { type: 'integer', description: 'Optional: Position index (0-based).' },
                },
                required: ['spreadsheet_id', 'title'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    addSheet: {
                                        properties: {
                                            title: params.title,
                                            index: params.index,
                                            gridProperties: {
                                                rowCount: params.row_count || 1000,
                                                columnCount: params.column_count || 26,
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    });

                    const sheetId = result.data.replies?.[0]?.addSheet?.properties?.sheetId;

                    return {
                        success: true,
                        data: { sheetId, title: params.title },
                        message: `📊 Sheet "${params.title}" added successfully!\n` +
                            `Sheet ID: \`${sheetId}\`\n` +
                            `Dimensions: ${params.row_count || 1000} rows × ${params.column_count || 26} columns`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to add sheet: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // DATA READING & WRITING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'sheets_read_range',
            description: 'Reads data from a specific range with optional value rendering.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: 'A1 notation range (e.g., "Sheet1!A1:D10").' },
                    value_render_option: {
                        type: 'string',
                        enum: ['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'],
                        description: 'Optional: How values should be rendered. Default "FORMATTED_VALUE".',
                    },
                },
                required: ['spreadsheet_id', 'range'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.get({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                        valueRenderOption: params.value_render_option || 'FORMATTED_VALUE',
                    });

                    const values = result.data.values || [];
                    if (values.length === 0) {
                        return { success: true, data: [], message: '📊 Range is empty.' };
                    }

                    const preview = values
                        .slice(0, 5)
                        .map((row, i) => `Row ${i + 1}: ${row.join(', ')}`)
                        .join('\n');

                    return {
                        success: true,
                        data: values,
                        message: `📊 Read ${values.length} row(s) from ${params.range}\n\n` +
                            `**Preview:**\n${preview}${values.length > 5 ? '\n...' : ''}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to read range: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_write_range',
            description: 'Writes data to a specific range (overwrites existing data).',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: 'A1 notation range (e.g., "Sheet1!A1").' },
                    values: {
                        type: 'array',
                        description: ' 2D array of values (e.g., [["Name", "Age"], ["John", 30]]).',
                    },
                    value_input_option: {
                        type: 'string',
                        enum: ['RAW', 'USER_ENTERED'],
                        description: 'Optional: How to interpret input. USER_ENTERED parses formulas. Default "USER_ENTERED".',
                    },
                },
                required: ['spreadsheet_id', 'range', 'values'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.update({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                        valueInputOption: params.value_input_option || 'USER_ENTERED',
                        requestBody: {
                            values: params.values as any[][],
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Successfully wrote data to ${params.range}\n` +
                            `Updated ${result.data.updatedRows} row(s), ${result.data.updatedColumns} column(s)\n` +
                            `Total cells: ${result.data.updatedCells}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to write data: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_append_rows',
            description: 'Appends rows to the end of a sheet (auto-detects table range).',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: 'Sheet name or range (e.g., "Sheet1" or "Sheet1!A:D").' },
                    values: {
                        type: 'array',
                        description: '2D array of values to append.',
                    },
                    value_input_option: {
                        type: 'string',
                        enum: ['RAW', 'USER_ENTERED'],
                        description: 'Optional: Default "USER_ENTERED".',
                    },
                },
                required: ['spreadsheet_id', 'range', 'values'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.append({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                        valueInputOption: params.value_input_option || 'USER_ENTERED',
                        requestBody: {
                            values: params.values as any[][],
                        },
                    });

                    const rowsAdded = params.values.length;

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Appended ${rowsAdded} row(s) to ${params.range}\n` +
                            `Updated range: ${result.data.updates?.updatedRange}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to append rows: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_batch_update',
            description: 'Performs multiple update operations atomically in a single batch request.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    ranges: {
                        type: 'array',
                        description: 'Array of objects: [{range: "Sheet1!A1", values: [[data]]}, ...]',
                    },
                    value_input_option: {
                        type: 'string',
                        enum: ['RAW', 'USER_ENTERED'],
                        description: 'Optional: Default "USER_ENTERED".',
                    },
                },
                required: ['spreadsheet_id', 'ranges'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const data = params.ranges.map((item: any) => ({
                        range: item.range,
                        values: item.values,
                    }));

                    const result = await sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            valueInputOption: params.value_input_option || 'USER_ENTERED',
                            data,
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Batch update completed successfully!\n` +
                            `Updated ${result.data.totalUpdatedRows} row(s), ${result.data.totalUpdatedCells} cell(s)\n` +
                            `Ranges: ${params.ranges.length}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed batch update: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_clear_range',
            description: 'Clears data from a specific range.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: 'A1 notation range to clear.' },
                },
                required: ['spreadsheet_id', 'range'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.clear({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `🗑️ Cleared range: ${result.data.clearedRange}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to clear range: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FORMATTING & STYLING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'sheets_format_cells',
            description: 'Applies formatting to cells using batch update (bold, colors, borders, number format).',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_id: { type: 'integer', description: 'The sheet ID (not name).' },
                    start_row: { type: 'integer', description: 'Start row index (0-based).' },
                    end_row: { type: 'integer', description: 'End row index (exclusive).' },
                    start_col: { type: 'integer', description: 'Start column index (0-based).' },
                    end_col: { type: 'integer', description: 'End column index (exclusive).' },
                    background_color: {
                        type: 'object',
                        description: 'Optional: RGB color {red: 0-1, green: 0-1, blue: 0-1}.',
                    },
                    text_color: {
                        type: 'object',
                        description: 'Optional: RGB color for text.',
                    },
                    bold: { type: 'boolean', description: 'Optional: Make text bold.' },
                    italic: { type: 'boolean', description: 'Optional: Make text italic.' },
                    font_size: { type: 'integer', description: 'Optional: Font size in points.' },
                    number_format: {
                        type: 'string',
                        description: 'Optional: Number format pattern (e.g., "0.00", "#,##0", "mmm dd, yyyy").',
                    },
                },
                required: ['spreadsheet_id', 'sheet_id', 'start_row', 'end_row', 'start_col', 'end_col'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const cellFormat: sheets_v4.Schema$CellFormat = {};
                    const fields: string[] = [];

                    if (params.background_color) {
                        cellFormat.backgroundColor = params.background_color as any;
                        fields.push('backgroundColor');
                    }
                    if (params.text_color || params.bold !== undefined || params.italic !== undefined || params.font_size) {
                        cellFormat.textFormat = {};
                        if (params.text_color) {
                            cellFormat.textFormat.foregroundColor = params.text_color as any;
                            fields.push('textFormat.foregroundColor');
                        }
                        if (params.bold !== undefined) {
                            cellFormat.textFormat.bold = params.bold;
                            fields.push('textFormat.bold');
                        }
                        if (params.italic !== undefined) {
                            cellFormat.textFormat.italic = params.italic;
                            fields.push('textFormat.italic');
                        }
                        if (params.font_size) {
                            cellFormat.textFormat.fontSize = params.font_size;
                            fields.push('textFormat.fontSize');
                        }
                    }
                    if (params.number_format) {
                        cellFormat.numberFormat = { type: 'NUMBER', pattern: params.number_format };
                        fields.push('numberFormat');
                    }

                    if (fields.length === 0) {
                        return { success: false, message: '⚠️ No formatting options specified.' };
                    }

                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    repeatCell: {
                                        range: {
                                            sheetId: params.sheet_id,
                                            startRowIndex: params.start_row,
                                            endRowIndex: params.end_row,
                                            startColumnIndex: params.start_col,
                                            endColumnIndex: params.end_col,
                                        },
                                        cell: {
                                            userEnteredFormat: cellFormat,
                                        },
                                        fields: fields.map((f) => `userEnteredFormat.${f}`).join(','),
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `🎨 Formatting applied successfully!\n` +
                            `Range: Rows ${params.start_row}-${params.end_row - 1}, Cols ${params.start_col}-${params.end_col - 1}\n` +
                            `Applied: ${fields.join(', ')}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to format cells: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_add_conditional_formatting',
            description: 'Adds conditional formatting rules to a range with criteria-based styling.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_id: { type: 'integer', description: 'The sheet ID.' },
                    start_row: { type: 'integer', description: 'Start row index (0-based).' },
                    end_row: { type: 'integer', description: 'End row index (exclusive).' },
                    start_col: { type: 'integer', description: 'Start column index (0-based).' },
                    end_col: { type: 'integer', description: 'End column index (exclusive).' },
                    condition_type: {
                        type: 'string',
                        enum: ['NUMBER_GREATER', 'NUMBER_LESS', 'NUMBER_BETWEEN', 'TEXT_CONTAINS', 'TEXT_EQ', 'DATE_AFTER', 'CUSTOM_FORMULA'],
                        description: 'Condition type.',
                    },
                    condition_values: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Condition values (e.g., ["100"] for NUMBER_GREATER, ["5", "10"] for NUMBER_BETWEEN).',
                    },
                    background_color: {
                        type: 'object',
                        description: 'Background color to apply when condition is met.',
                    },
                    text_color: {
                        type: 'object',
                        description: 'Optional: Text color.',
                    },
                },
                required: ['spreadsheet_id', 'sheet_id', 'start_row', 'end_row', 'start_col', 'end_col', 'condition_type', 'condition_values', 'background_color'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const format: sheets_v4.Schema$CellFormat = {
                        backgroundColor: params.background_color as any,
                    };

                    if (params.text_color) {
                        format.textFormat = { foregroundColor: params.text_color as any };
                    }

                    const booleanRule: sheets_v4.Schema$BooleanRule = {
                        condition: {
                            type: params.condition_type,
                            values: params.condition_values.map((v: string) => ({ userEnteredValue: v })),
                        },
                        format,
                    };

                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    addConditionalFormatRule: {
                                        rule: {
                                            ranges: [
                                                {
                                                    sheetId: params.sheet_id,
                                                    startRowIndex: params.start_row,
                                                    endRowIndex: params.end_row,
                                                    startColumnIndex: params.start_col,
                                                    endColumnIndex: params.end_col,
                                                },
                                            ],
                                            booleanRule,
                                        },
                                        index: 0,
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `🎨 Conditional formatting added successfully!\n` +
                            `Condition: ${params.condition_type}\n` +
                            `Values: ${params.condition_values.join(', ')}\n` +
                            `Range: Rows ${params.start_row}-${params.end_row - 1}, Cols ${params.start_col}-${params.end_col - 1}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to add conditional formatting: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // ADVANCED OPERATIONS
        // ═══════════════════════════════════════════════════════════

        {
            name: 'sheets_sort_range',
            description: 'Sorts a range by one or more columns.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_id: { type: 'integer', description: 'The sheet ID.' },
                    start_row: { type: 'integer', description: 'Start row index (0-based).' },
                    end_row: { type: 'integer', description: 'End row index (exclusive).' },
                    start_col: { type: 'integer', description: 'Start column index (0-based).' },
                    end_col: { type: 'integer', description: 'End column index (exclusive).' },
                    sort_column: { type: 'integer', description: 'Column index to sort by (0-based).' },
                    ascending: { type: 'boolean', description: 'Optional: Sort order. Default true (ascending).' },
                },
                required: ['spreadsheet_id', 'sheet_id', 'start_row', 'end_row', 'start_col', 'end_col', 'sort_column'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    sortRange: {
                                        range: {
                                            sheetId: params.sheet_id,
                                            startRowIndex: params.start_row,
                                            endRowIndex: params.end_row,
                                            startColumnIndex: params.start_col,
                                            endColumnIndex: params.end_col,
                                        },
                                        sortSpecs: [
                                            {
                                                dimensionIndex: params.sort_column,
                                                sortOrder: params.ascending !== false ? 'ASCENDING' : 'DESCENDING',
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Range sorted successfully!\n` +
                            `Sort column: ${params.sort_column}\n` +
                            `Order: ${params.ascending !== false ? 'Ascending' : 'Descending'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to sort range: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_insert_rows',
            description: 'Inserts new blank rows at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_id: { type: 'integer', description: 'The sheet ID.' },
                    start_index: { type: 'integer', description: 'Row index to insert at (0-based).' },
                    count: { type: 'integer', description: 'Number of rows to insert.' },
                },
                required: ['spreadsheet_id', 'sheet_id', 'start_index', 'count'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    insertDimension: {
                                        range: {
                                            sheetId: params.sheet_id,
                                            dimension: 'ROWS',
                                            startIndex: params.start_index,
                                            endIndex: params.start_index + params.count,
                                        },
                                    },
                                },
                            ],
                        },
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Inserted ${params.count} row(s) at position ${params.start_index}.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to insert rows: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'sheets_delete_rows',
            description: 'Deletes rows from a sheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_id: { type: 'integer', description: 'The sheet ID.' },
                    start_index: { type: 'integer', description: 'Start row index to delete (0-based).' },
                    end_index: { type: 'integer', description: 'End row index (exclusive).' },
                },
                required: ['spreadsheet_id', 'sheet_id', 'start_index', 'end_index'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: params.spreadsheet_id,
                        requestBody: {
                            requests: [
                                {
                                    deleteDimension: {
                                        range: {
                                            sheetId: params.sheet_id,
                                            dimension: 'ROWS',
                                            startIndex: params.start_index,
                                            endIndex: params.end_index,
                                        },
                                    },
                                },
                            ],
                        },
                    });

                    const deletedCount = params.end_index - params.start_index;

                    return {
                        success: true,
                        data: result.data,
                        message: `🗑️ Deleted ${deletedCount} row(s) (${params.start_index} to ${params.end_index - 1}).`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete rows: ${error.message}`,
                    };
                }
            },
        },
    ];
}