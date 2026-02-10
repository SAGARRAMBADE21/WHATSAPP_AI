import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getSheetsClient(auth: OAuth2Client): sheets_v4.Sheets {
    return google.sheets({ version: 'v4', auth });
}

export function createSheetsTools(auth: OAuth2Client): ToolDefinition[] {
    const sheets = getSheetsClient(auth);

    return [
        // ── sheets_read_data ──
        {
            name: 'sheets_read_data',
            description: 'Reads data from a specified range in a Google Sheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: "The A1 notation range (e.g., 'Sheet1!A1:C5')." },
                },
                required: ['spreadsheet_id', 'range'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.get({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                    });

                    const rows = result.data.values || [];
                    if (rows.length === 0) {
                        return { success: true, data: [], message: `📊 No data found in range ${params.range}.` };
                    }

                    // Format as a simple table
                    const header = rows[0];
                    const formatted = rows
                        .map((row, i) => (i === 0 ? `**${row.join(' | ')}**` : row.join(' | ')))
                        .join('\n');

                    return {
                        success: true,
                        data: { range: result.data.range, values: rows },
                        message: `📊 Data from ${params.range}:\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to read sheet: ${error.message}` };
                }
            },
        },

        // ── sheets_write_data ──
        {
            name: 'sheets_write_data',
            description: 'Writes data to a specified range in a Google Sheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    range: { type: 'string', description: "The A1 notation range to write to (e.g., 'Sheet1!A1')." },
                    values: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: '2D array of values to write.' },
                    value_input_option: { type: 'string', enum: ['RAW', 'USER_ENTERED'], description: "Optional: How to interpret values. Default 'USER_ENTERED'." },
                },
                required: ['spreadsheet_id', 'range', 'values'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.update({
                        spreadsheetId: params.spreadsheet_id,
                        range: params.range,
                        valueInputOption: params.value_input_option || 'USER_ENTERED',
                        requestBody: { values: params.values },
                    });

                    return {
                        success: true,
                        data: { updatedCells: result.data.updatedCells, updatedRange: result.data.updatedRange },
                        message: `📊 Updated ${result.data.updatedCells} cell(s) in ${result.data.updatedRange}.`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to write data: ${error.message}` };
                }
            },
        },

        // ── sheets_update_cell ──
        {
            name: 'sheets_update_cell',
            description: 'Updates a single cell in a Google Sheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_name: { type: 'string', description: "The name of the sheet (tab)." },
                    cell_address: { type: 'string', description: "The A1 notation of the cell (e.g., 'B5')." },
                    value: { type: 'string', description: 'The value to write.' },
                },
                required: ['spreadsheet_id', 'sheet_name', 'cell_address', 'value'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const range = `${params.sheet_name}!${params.cell_address}`;
                    const result = await sheets.spreadsheets.values.update({
                        spreadsheetId: params.spreadsheet_id,
                        range,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[params.value]] },
                    });

                    return {
                        success: true,
                        data: { updatedRange: result.data.updatedRange },
                        message: `📊 Cell ${params.cell_address} on "${params.sheet_name}" updated to "${params.value}".`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to update cell: ${error.message}` };
                }
            },
        },

        // ── sheets_add_row ──
        {
            name: 'sheets_add_row',
            description: 'Appends a new row of data to a Google Sheet.',
            parameters: {
                type: 'object',
                properties: {
                    spreadsheet_id: { type: 'string', description: 'The ID of the spreadsheet.' },
                    sheet_name: { type: 'string', description: 'The name of the sheet (tab).' },
                    values: { type: 'array', items: { type: 'string' }, description: 'Array of values for the new row.' },
                },
                required: ['spreadsheet_id', 'sheet_name', 'values'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await sheets.spreadsheets.values.append({
                        spreadsheetId: params.spreadsheet_id,
                        range: `${params.sheet_name}!A1`,
                        valueInputOption: 'USER_ENTERED',
                        insertDataOption: 'INSERT_ROWS',
                        requestBody: { values: [params.values] },
                    });

                    return {
                        success: true,
                        data: { updatedRange: result.data.updates?.updatedRange },
                        message: `📊 New row added to "${params.sheet_name}": [${params.values.join(', ')}]`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to add row: ${error.message}` };
                }
            },
        },
    ];
}