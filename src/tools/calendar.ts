import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getCalendarClient(auth: OAuth2Client): calendar_v3.Calendar {
    return google.calendar({ version: 'v3', auth });
}

export function createCalendarTools(auth: OAuth2Client): ToolDefinition[] {
    const calendar = getCalendarClient(auth);

    return [
        // ── calendar_create_event ──
        {
            name: 'calendar_create_event',
            description: "Creates a new event on the user's Google Calendar.",
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'The title of the event.' },
                    start_time: { type: 'string', description: 'Start time in ISO 8601 format.' },
                    end_time: { type: 'string', description: 'End time in ISO 8601 format.' },
                    description: { type: 'string', description: 'Optional: Description of the event.' },
                    attendees: { type: 'array', items: { type: 'string' }, description: 'Optional: List of attendee email addresses.' },
                    location: { type: 'string', description: 'Optional: Location of the event.' },
                },
                required: ['summary', 'start_time', 'end_time'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const event: calendar_v3.Schema$Event = {
                        summary: params.summary,
                        description: params.description,
                        location: params.location,
                        start: { dateTime: params.start_time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                        end: { dateTime: params.end_time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                    };

                    if (params.attendees) {
                        event.attendees = params.attendees.map((email: string) => ({ email }));
                    }

                    const result = await calendar.events.insert({
                        calendarId: 'primary',
                        requestBody: event,
                        sendUpdates: params.attendees ? 'all' : 'none',
                    });

                    return {
                        success: true,
                        data: { eventId: result.data.id, htmlLink: result.data.htmlLink },
                        message: `📅 Event created: "${params.summary}"\n🕐 ${params.start_time} → ${params.end_time}${params.attendees ? `\n👥 Invites sent to: ${params.attendees.join(', ')}` : ''}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to create event: ${error.message}` };
                }
            },
        },

        // ── calendar_list_events ──
        {
            name: 'calendar_list_events',
            description: "Lists events from the user's Google Calendar.",
            parameters: {
                type: 'object',
                properties: {
                    time_min: { type: 'string', description: 'Optional: Start of time range in ISO 8601.' },
                    time_max: { type: 'string', description: 'Optional: End of time range in ISO 8601.' },
                    max_results: { type: 'integer', description: 'Optional: Maximum number of events to return.' },
                    query: { type: 'string', description: 'Optional: Free text search query.' },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const now = new Date();
                    const result = await calendar.events.list({
                        calendarId: 'primary',
                        timeMin: params.time_min || now.toISOString(),
                        timeMax: params.time_max,
                        maxResults: params.max_results || 10,
                        singleEvents: true,
                        orderBy: 'startTime',
                        q: params.query,
                    });

                    const events = result.data.items || [];
                    if (events.length === 0) {
                        return { success: true, data: [], message: '📅 No upcoming events found for the specified time range.' };
                    }

                    const formatted = events
                        .map((e, i) => {
                            const start = e.start?.dateTime || e.start?.date || 'N/A';
                            const end = e.end?.dateTime || e.end?.date || '';
                            return `${i + 1}. **${e.summary || 'Untitled'}** — ${start}${end ? ` to ${end}` : ''}${e.location ? ` 📍 ${e.location}` : ''}\n   ID: \`${e.id}\``;
                        })
                        .join('\n');

                    return {
                        success: true,
                        data: events.map((e) => ({
                            id: e.id,
                            summary: e.summary,
                            start: e.start?.dateTime || e.start?.date,
                            end: e.end?.dateTime || e.end?.date,
                            location: e.location,
                        })),
                        message: `📅 Found ${events.length} event(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to list events: ${error.message}` };
                }
            },
        },

        // ── calendar_update_event ──
        {
            name: 'calendar_update_event',
            description: "Updates an existing event on the user's Google Calendar.",
            parameters: {
                type: 'object',
                properties: {
                    event_id: { type: 'string', description: 'The unique ID of the event to update.' },
                    summary: { type: 'string', description: 'Optional: New title.' },
                    start_time: { type: 'string', description: 'Optional: New start time in ISO 8601.' },
                    end_time: { type: 'string', description: 'Optional: New end time in ISO 8601.' },
                    description: { type: 'string', description: 'Optional: New description.' },
                    attendees: { type: 'array', items: { type: 'string' }, description: 'Optional: Updated attendee list.' },
                    location: { type: 'string', description: 'Optional: New location.' },
                },
                required: ['event_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Fetch existing event
                    const existing = await calendar.events.get({ calendarId: 'primary', eventId: params.event_id });
                    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

                    const updates: calendar_v3.Schema$Event = {};
                    if (params.summary) updates.summary = params.summary;
                    if (params.description) updates.description = params.description;
                    if (params.location) updates.location = params.location;
                    if (params.start_time) updates.start = { dateTime: params.start_time, timeZone: tz };
                    if (params.end_time) updates.end = { dateTime: params.end_time, timeZone: tz };
                    if (params.attendees) updates.attendees = params.attendees.map((email: string) => ({ email }));

                    const result = await calendar.events.patch({
                        calendarId: 'primary',
                        eventId: params.event_id,
                        requestBody: updates,
                        sendUpdates: 'all',
                    });

                    return {
                        success: true,
                        data: { eventId: result.data.id },
                        message: `📅 Event "${result.data.summary}" updated successfully.`,
                    };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to update event: ${error.message}` };
                }
            },
        },

        // ── calendar_delete_event ──
        {
            name: 'calendar_delete_event',
            description: "Deletes an event from the user's Google Calendar.",
            parameters: {
                type: 'object',
                properties: {
                    event_id: { type: 'string', description: 'The unique ID of the event to delete.' },
                },
                required: ['event_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await calendar.events.delete({
                        calendarId: 'primary',
                        eventId: params.event_id,
                        sendUpdates: 'all',
                    });
                    return { success: true, message: `🗑️ Event ${params.event_id} deleted from calendar.` };
                } catch (error: any) {
                    return { success: false, error: error.message, message: `❌ Failed to delete event: ${error.message}` };
                }
            },
        },
    ];
}