import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getCalendarClient(auth: OAuth2Client): calendar_v3.Calendar {
    return google.calendar({ version: 'v3', auth });
}

/**
 * Industrial-grade Google Calendar tools with recurring events, batch operations,
 * advanced time zone handling, and event management based on 2024 API best practices.
 */
export function createCalendarTools(auth: OAuth2Client): ToolDefinition[] {
    const calendar = getCalendarClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // EVENT CREATION & MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'calendar_create_event',
            description: 'Creates a calendar event with advanced options (attendees, reminders, recurrence, conference).',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Event title/summary.' },
                    start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g., "2024-02-15T10:00:00").' },
                    end_time: { type: 'string', description: 'End time in ISO 8601 format.' },
                    time_zone: { type: 'string', description: 'Optional: Time zone (e.g., "Asia/Kolkata"). Default: user calendar timezone.' },
                    description: { type: 'string', description: 'Optional: Event description/details.' },
                    location: { type: 'string', description: 'Optional: Event location.' },
                    attendees: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Array of attendee email addresses.',
                    },
                    recurrence: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional: Recurrence rules in RFC 5545 format (e.g., ["RRULE:FREQ=DAILY;COUNT=10"]).',
                    },
                    reminders: {
                        type: 'object',
                        description: 'Optional: Reminder settings {useDefault: false, overrides: [{method: "email", minutes: 30}]}',
                    },
                    send_updates: {
                        type: 'string',
                        enum: ['all', 'externalOnly', 'none'],
                        description: 'Optional: Send email notifications. Default "none".',
                    },
                    conference_solution: {
                        type: 'boolean',
                        description: 'Optional: Create Google Meet link. Default false.',
                    },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                },
                required: ['summary', 'start_time', 'end_time'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const event: calendar_v3.Schema$Event = {
                        summary: params.summary,
                        description: params.description,
                        location: params.location,
                        start: {
                            dateTime: params.start_time,
                            timeZone: params.time_zone,
                        },
                        end: {
                            dateTime: params.end_time,
                            timeZone: params.time_zone,
                        },
                    };

                    if (params.attendees && params.attendees.length > 0) {
                        event.attendees = params.attendees.map((email: string) => ({ email }));
                    }

                    if (params.recurrence) {
                        event.recurrence = params.recurrence;
                    }

                    if (params.reminders) {
                        event.reminders = params.reminders as any;
                    }

                    if (params.conference_solution) {
                        event.conferenceData = {
                            createRequest: {
                                requestId: `meet-${Date.now()}`,
                                conferenceSolutionKey: { type: 'hangoutsMeet' },
                            },
                        };
                    }

                    const result = await calendar.events.insert({
                        calendarId: params.calendar_id || 'primary',
                        conferenceDataVersion: params.conference_solution ? 1 : 0,
                        sendUpdates: params.send_updates as any || 'none',
                        requestBody: event,
                    });

                    const meetLink = result.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

                    return {
                        success: true,
                        data: result.data,
                        message: `📅 Event "${params.summary}" created successfully!\n\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Start: ${params.start_time}\n` +
                            `End: ${params.end_time}\n` +
                            `${params.attendees ? `Attendees: ${params.attendees.length}\n` : ''}` +
                            `${params.recurrence ? `Recurring: Yes\n` : ''}` +
                            `${meetLink ? `Meet Link: ${meetLink}\n` : ''}` +
                            `Link: ${result.data.htmlLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create event: ${error.message}\n\n💡 Check date format and permissions.`,
                    };
                }
            },
        },

        {
            name: 'calendar_quick_add_event',
            description: 'Quickly creates an event using natural language (e.g., "Lunch tomorrow at 12pm").',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: 'Natural language event description.' },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                    send_updates: {
                        type: 'string',
                        enum: ['all', 'externalOnly', 'none'],
                        description: 'Optional: Send notifications. Default "none".',
                    },
                },
                required: ['text'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await calendar.events.quickAdd({
                        calendarId: params.calendar_id || 'primary',
                        text: params.text,
                        sendUpdates: params.send_updates as any || 'none',
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📅 Event created from: "${params.text}"\n\n` +
                            `Title: ${result.data.summary}\n` +
                            `Start: ${result.data.start?.dateTime || result.data.start?.date}\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Link: ${result.data.htmlLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create event: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'calendar_update_event',
            description: 'Updates an existing event with new details.',
            parameters: {
                type: 'object',
                properties: {
                    event_id: { type: 'string', description: 'The ID of the event to update.' },
                    summary: { type: 'string', description: 'Optional: New event title.' },
                    start_time: { type: 'string', description: 'Optional: New start time (ISO 8601).' },
                    end_time: { type: 'string', description: 'Optional: New end time (ISO 8601).' },
                    time_zone: { type: 'string', description: 'Optional: Time zone.' },
                    description: { type: 'string', description: 'Optional: New description.' },
                    location: { type: 'string', description: 'Optional: New location.' },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                    send_updates: {
                        type: 'string',
                        enum: ['all', 'externalOnly', 'none'],
                        description: 'Optional: Send updates. Default "all".',
                    },
                },
                required: ['event_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // First get the current event
                    const currentEvent = await calendar.events.get({
                        calendarId: params.calendar_id || 'primary',
                        eventId: params.event_id,
                    });

                    // Update only provided fields
                    const updatedEvent: calendar_v3.Schema$Event = { ...currentEvent.data };

                    if (params.summary) updatedEvent.summary = params.summary;
                    if (params.description !== undefined) updatedEvent.description = params.description;
                    if (params.location !== undefined) updatedEvent.location = params.location;

                    if (params.start_time) {
                        updatedEvent.start = {
                            dateTime: params.start_time,
                            timeZone: params.time_zone || updatedEvent.start?.timeZone,
                        };
                    }

                    if (params.end_time) {
                        updatedEvent.end = {
                            dateTime: params.end_time,
                            timeZone: params.time_zone || updatedEvent.end?.timeZone,
                        };
                    }

                    const result = await calendar.events.update({
                        calendarId: params.calendar_id || 'primary',
                        eventId: params.event_id,
                        sendUpdates: params.send_updates as any || 'all',
                        requestBody: updatedEvent,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📅 Event updated successfully!\n\n` +
                            `Title: ${result.data.summary}\n` +
                            `Start: ${result.data.start?.dateTime || result.data.start?.date}\n` +
                            `Link: ${result.data.htmlLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to update event: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'calendar_delete_event',
            description: 'Deletes a calendar event.',
            parameters: {
                type: 'object',
                properties: {
                    event_id: { type: 'string', description: 'The ID of the event to delete.' },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                    send_updates: {
                        type: 'string',
                        enum: ['all', 'externalOnly', 'none'],
                        description: 'Optional: Send cancellation. Default "all".',
                    },
                },
                required: ['event_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await calendar.events.delete({
                        calendarId: params.calendar_id || 'primary',
                        eventId: params.event_id,
                        sendUpdates: params.send_updates as any || 'all',
                    });

                    return {
                        success: true,
                        data: { eventId: params.event_id },
                        message: `🗑️ Event deleted successfully.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete event: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // EVENT LISTING & SEARCH
        // ═══════════════════════════════════════════════════════════

        {
            name: 'calendar_list_events',
            description: 'Lists upcoming events with advanced filtering and pagination.',
            parameters: {
                type: 'object',
                properties: {
                    time_min: {
                        type: 'string',
                        description: 'Optional: Start of time range (ISO 8601). Default: now.',
                    },
                    time_max: {
                        type: 'string',
                        description: 'Optional: End of time range (ISO 8601).',
                    },
                    max_results: { type: 'integer', description: 'Optional: Max events (1-2500). Default 10.' },
                    query: { type: 'string', description: 'Optional: Free text search query.' },
                    single_events: {
                        type: 'boolean',
                        description: 'Optional: Expand recurring events. Default true.',
                    },
                    order_by: {
                        type: 'string',
                        enum: ['startTime', 'updated'],
                        description: 'Optional: Sort order. Default "startTime".',
                    },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await calendar.events.list({
                        calendarId: params.calendar_id || 'primary',
                        timeMin: params.time_min || new Date().toISOString(),
                        timeMax: params.time_max,
                        maxResults: Math.min(params.max_results || 10, 2500),
                        singleEvents: params.single_events !== false,
                        orderBy: params.order_by || 'startTime',
                        q: params.query,
                    });

                    const events = result.data.items || [];
                    if (events.length === 0) {
                        return { success: true, data: [], message: '📅 No upcoming events found.' };
                    }

                    const formatted = events
                        .map((e, i) => {
                            const start = e.start?.dateTime || e.start?.date || 'N/A';
                            const end = e.end?.dateTime || e.end?.date || 'N/A';
                            const recurring = e.recurringEventId ? '🔄 ' : '';
                            const attendees = e.attendees?.length || 0;
                            const location = e.location ? `\n   Location: ${e.location}` : '';

                            return (
                                `${i + 1}. ${recurring}**${e.summary}**\n` +
                                `   Start: ${start}\n` +
                                `   End: ${end}${location}\n` +
                                `   ${attendees > 0 ? `Attendees: ${attendees}\n   ` : ''}` +
                                `ID: \`${e.id}\``
                            );
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: events,
                        message: `📅 Found ${events.length} event(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list events: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'calendar_get_event',
            description: 'Gets detailed information about a specific event.',
            parameters: {
                type: 'object',
                properties: {
                    event_id: { type: 'string', description: 'The ID of the event.' },
                    calendar_id: { type: 'string', description: 'Optional: Calendar ID. Default "primary".' },
                },
                required: ['event_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await calendar.events.get({
                        calendarId: params.calendar_id || 'primary',
                        eventId: params.event_id,
                    });

                    const event = result.data;
                    const start = event.start?.dateTime || event.start?.date || 'N/A';
                    const end = event.end?.dateTime || event.end?.date || 'N/A';
                    const attendees = event.attendees?.map((a) => `${a.email} (${a.responseStatus})`).join(', ') || 'None';
                    const recurring = event.recurrence ? `\nRecurrence: ${event.recurrence.join(', ')}` : '';
                    const meetLink = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;

                    return {
                        success: true,
                        data: event,
                        message: `📅 **${event.summary}**\n\n` +
                            `Start: ${start}\n` +
                            `End: ${end}\n` +
                            `${event.location ? `Location: ${event.location}\n` : ''}` +
                            `${event.description ? `Description: ${event.description}\n` : ''}` +
                            `Attendees: ${attendees}${recurring}\n` +
                            `${meetLink ? `Meet Link: ${meetLink}\n` : ''}` +
                            `Creator: ${event.creator?.email}\n` +
                            `Link: ${event.htmlLink}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get event: ${error.message}`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // CALENDAR MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'calendar_list_calendars',
            description: 'Lists all calendars accessible to the user.',
            parameters: {
                type: 'object',
                properties: {
                    show_hidden: { type: 'boolean', description: 'Optional: Include hidden calendars. Default false.' },
                },
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await calendar.calendarList.list({
                        showHidden: params.show_hidden || false,
                    });

                    const calendars = result.data.items || [];
                    if (calendars.length === 0) {
                        return { success: true, data: [], message: '📅 No calendars found.' };
                    }

                    const formatted = calendars
                        .map((cal, i) => {
                            const primary = cal.primary ? '⭐ ' : '';
                            const access = cal.accessRole || 'unknown';
                            return (
                                `${i + 1}. ${primary}**${cal.summary}**\n` +
                                `   Access: ${access}\n` +
                                `   Time Zone: ${cal.timeZone}\n` +
                                `   ID: \`${cal.id}\``
                            );
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: calendars,
                        message: `📅 Found ${calendars.length} calendar(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list calendars: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'calendar_create_calendar',
            description: 'Creates a new secondary calendar.',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Calendar name/title.' },
                    description: { type: 'string', description: 'Optional: Calendar description.' },
                    time_zone: { type: 'string', description: 'Optional: Time zone (e.g., "Asia/Kolkata").' },
                },
                required: ['summary'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const calendarData: calendar_v3.Schema$Calendar = {
                        summary: params.summary,
                        description: params.description,
                        timeZone: params.time_zone,
                    };

                    const result = await calendar.calendars.insert({
                        requestBody: calendarData,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📅 Calendar "${params.summary}" created successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Time Zone: ${result.data.timeZone}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create calendar: ${error.message}`,
                    };
                }
            },
        },

        {
            name: 'calendar_delete_calendar',
            description: 'Deletes a secondary calendar (cannot delete primary calendar).',
            parameters: {
                type: 'object',
                properties: {
                    calendar_id: { type: 'string', description: 'The ID of the calendar to delete.' },
                },
                required: ['calendar_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    await calendar.calendars.delete({
                        calendarId: params.calendar_id,
                    });

                    return {
                        success: true,
                        data: { calendarId: params.calendar_id },
                        message: `🗑️ Calendar deleted successfully.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to delete calendar: ${error.message}\n\n💡 Primary calendar cannot be deleted.`,
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // FREE/BUSY & AVAILABILITY
        // ═══════════════════════════════════════════════════════════

        {
            name: 'calendar_check_freebusy',
            description: 'Checks free/busy status for specified calendars in a time range.',
            parameters: {
                type: 'object',
                properties: {
                    time_min: { type: 'string', description: 'Start time (ISO 8601).' },
                    time_max: { type: 'string', description: 'End time (ISO 8601).' },
                    calendar_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of calendar IDs to check. Default: ["primary"].',
                    },
                    time_zone: { type: 'string', description: 'Optional: Time zone for results.' },
                },
                required: ['time_min', 'time_max'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await calendar.freebusy.query({
                        requestBody: {
                            timeMin: params.time_min,
                            timeMax: params.time_max,
                            timeZone: params.time_zone,
                            items: (params.calendar_ids || ['primary']).map((id: string) => ({ id })),
                        },
                    });

                    const calendars = result.data.calendars || {};
                    const formatted = Object.entries(calendars)
                        .map(([calId, calData]) => {
                            const busy = (calData as any).busy || [];
                            if (busy.length === 0) {
                                return `📅 **${calId}**: Free for entire period`;
                            }
                            const busyTimes = busy
                                .map((b: any, i: number) => `   ${i + 1}. ${b.start} to ${b.end}`)
                                .join('\n');
                            return `📅 **${calId}**:\n   Busy periods (${busy.length}):\n${busyTimes}`;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: calendars,
                        message: `⏰ Free/Busy for ${params.time_min} to ${params.time_max}:\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to check free/busy: ${error.message}`,
                    };
                }
            },
        },
    ];
}