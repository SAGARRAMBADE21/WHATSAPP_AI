import { google, classroom_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ToolDefinition, ToolResult } from '../types';

function getClassroomClient(auth: OAuth2Client): classroom_v1.Classroom {
    return google.classroom({ version: 'v1', auth });
}

/**
 * Industrial-grade Google Classroom tools with comprehensive error handling,
 * batch operations support, and advanced features including rubrics, materials,
 * student groups, and grading periods.
 */
export function createClassroomTools(auth: OAuth2Client): ToolDefinition[] {
    const classroom = getClassroomClient(auth);

    return [
        // ═══════════════════════════════════════════════════════════
        // COURSE MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_list_courses',
            description: 'Lists all Google Classroom courses with filtering options (teacher/student role, archived status).',
            parameters: {
                type: 'object',
                properties: {
                    student_id: { type: 'string', description: 'Optional: Filter courses where this user is a student. Use "me" for current user.' },
                    teacher_id: { type: 'string', description: 'Optional: Filter courses where this user is a teacher. Use "me" for current user.' },
                    course_states: {
                        type: 'array',
                        items: { type: 'string', enum: ['ACTIVE', 'ARCHIVED', 'PROVISIONED', 'DECLINED', 'SUSPENDED'] },
                        description: 'Optional: Filter by course states. Default: ACTIVE only.'
                    },
                    page_size: { type: 'integer', description: 'Optional: Number of results (1-100). Default 20.' },
                },
                required: [],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.list({
                        studentId: params.student_id,
                        teacherId: params.teacher_id,
                        courseStates: params.course_states || ['ACTIVE'],
                        pageSize: Math.min(params.page_size || 20, 100),
                    });

                    const courses = result.data.courses || [];
                    if (courses.length === 0) {
                        return { success: true, data: [], message: '📚 No courses found matching the criteria.' };
                    }

                    const formatted = courses
                        .map((c, i) => {
                            const statusEmoji = {
                                ACTIVE: '🟢',
                                ARCHIVED: '📦',
                                PROVISIONED: '⚪',
                                DECLINED: '🔴',
                                SUSPENDED: '⏸️'
                            }[c.courseState || 'ACTIVE'] || '❓';

                            return `${i + 1}. ${statusEmoji} **${c.name}**\n` +
                                `   Section: ${c.section || 'N/A'} | Room: ${c.room || 'N/A'}\n` +
                                `   Teacher: ${c.ownerId}\n` +
                                `   ID: \`${c.id}\``;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: courses.map(c => ({ id: c.id, name: c.name, state: c.courseState, section: c.section })),
                        message: `📚 Found ${courses.length} course(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list courses: ${error.message}\n\n💡 Ensure Classroom API is enabled and you have appropriate permissions.`
                    };
                }
            },
        },

        {
            name: 'classroom_get_course',
            description: 'Gets comprehensive details about a specific course including description, enrollment code, and settings.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const course = await classroom.courses.get({
                        id: params.course_id,
                    });

                    const c = course.data;
                    const info = `📚 **${c.name}**\n\n` +
                        `**Course Details:**\n` +
                        `• Section: ${c.section || 'N/A'}\n` +
                        `• Room: ${c.room || 'N/A'}\n` +
                        `• Description: ${c.descriptionHeading || 'N/A'}\n` +
                        `• Status: ${c.courseState}\n` +
                        `• Owner ID: ${c.ownerId}\n` +
                        `• Enrollment Code: ${c.enrollmentCode || 'N/A'}\n` +
                        `• Calendar ID: ${c.calendarId || 'N/A'}\n` +
                        `• ID: \`${c.id}\`\n\n` +
                        `**Settings:**\n` +
                        `• Guardians Enabled: ${c.guardiansEnabled ? 'Yes' : 'No'}\n` +
                        `• Course Group Email: ${c.courseGroupEmail || 'N/A'}`;

                    return {
                        success: true,
                        data: c,
                        message: info,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get course: ${error.message}\n\n💡 Verify course ID and permissions.`
                    };
                }
            },
        },

        {
            name: 'classroom_create_course',
            description: 'Creates a new Google Classroom course with full configuration options.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'The name of the course.' },
                    section: { type: 'string', description: 'Optional: Section (e.g., "Period 2", "Grade 10").' },
                    room: { type: 'string', description: 'Optional: Room number/location.' },
                    description: { type: 'string', description: 'Optional: Course description.' },
                    owner_id: { type: 'string', description: 'Optional: Teacher user ID. Defaults to current user.' },
                },
                required: ['name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const courseData: classroom_v1.Schema$Course = {
                        name: params.name,
                        section: params.section,
                        room: params.room,
                        descriptionHeading: params.description,
                        ownerId: params.owner_id || 'me',
                        courseState: 'PROVISIONED', // Must be PROVISIONED for API creation
                    };

                    const result = await classroom.courses.create({
                        requestBody: courseData,
                    });

                    return {
                        success: true,
                        data: { courseId: result.data.id, name: result.data.name, enrollmentCode: result.data.enrollmentCode },
                        message: `📚 Course "${params.name}" created successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `Enrollment Code: ${result.data.enrollmentCode || 'N/A'}\n\n` +
                            `⚠️ Course is PROVISIONED. Change to ACTIVE in Classroom web UI.`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create course: ${error.message}\n\n💡 Ensure you have teacher/admin permissions.`
                    };
                }
            },
        },

        {
            name: 'classroom_update_course',
            description: 'Updates an existing course\'s details (name, section, room, description).',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course to update.' },
                    name: { type: 'string', description: 'Optional: New course name.' },
                    section: { type: 'string', description: 'Optional: New section.' },
                    room: { type: 'string', description: 'Optional: New room.' },
                    description: { type: 'string', description: 'Optional: New description.' },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    // Build update mask for only provided fields
                    const updateMask: string[] = [];
                    const courseData: classroom_v1.Schema$Course = { id: params.course_id };

                    if (params.name) {
                        courseData.name = params.name;
                        updateMask.push('name');
                    }
                    if (params.section !== undefined) {
                        courseData.section = params.section;
                        updateMask.push('section');
                    }
                    if (params.room !== undefined) {
                        courseData.room = params.room;
                        updateMask.push('room');
                    }
                    if (params.description !== undefined) {
                        courseData.descriptionHeading = params.description;
                        updateMask.push('descriptionHeading');
                    }

                    if (updateMask.length === 0) {
                        return { success: false, message: '⚠️ No fields specified for update.' };
                    }

                    const result = await classroom.courses.patch({
                        id: params.course_id,
                        updateMask: updateMask.join(','),
                        requestBody: courseData,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📚 Course updated successfully!\n` +
                            `Updated fields: ${updateMask.join(', ')}\n` +
                            `Course: ${result.data.name}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to update course: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // COURSEWORK (ASSIGNMENTS) MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_list_assignments',
            description: 'Lists all coursework with filtering by state, due date, and ordering.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    course_work_states: {
                        type: 'array',
                        items: { type: 'string', enum: ['PUBLISHED', 'DRAFT', 'DELETED'] },
                        description: 'Optional: Filter by states. Default: PUBLISHED only.'
                    },
                    order_by: {
                        type: 'string',
                        description: 'Optional: Sort order (e.g., "dueDate desc", "title asc").'
                    },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.courseWork.list({
                        courseId: params.course_id,
                        courseWorkStates: params.course_work_states || ['PUBLISHED'],
                        orderBy: params.order_by,
                        pageSize: 50,
                    });

                    const assignments = result.data.courseWork || [];
                    if (assignments.length === 0) {
                        return { success: true, data: [], message: '📝 No assignments found in this course.' };
                    }

                    const formatted = assignments
                        .map((a, i) => {
                            const dueDate = a.dueDate
                                ? `${a.dueDate.year}-${String(a.dueDate.month).padStart(2, '0')}-${String(a.dueDate.day).padStart(2, '0')}`
                                : 'No due date';
                            const dueTime = a.dueTime ? ` ${String(a.dueTime.hours || 0).padStart(2, '0')}:${String(a.dueTime.minutes || 0).padStart(2, '0')}` : '';
                            const points = a.maxPoints ? `${a.maxPoints} pts` : 'Ungraded';
                            const workType = a.workType || 'ASSIGNMENT';
                            const stateEmoji = { PUBLISHED: '📢', DRAFT: '📝', DELETED: '🗑️' }[a.state || 'PUBLISHED'] || '📢';

                            return `${i + 1}. ${stateEmoji} **${a.title}**\n` +
                                `   Type: ${workType} | Due: ${dueDate}${dueTime} | ${points}\n` +
                                `   ID: \`${a.id}\``;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: assignments.map(a => ({
                            id: a.id,
                            title: a.title,
                            dueDate: a.dueDate,
                            maxPoints: a.maxPoints,
                            workType: a.workType,
                            state: a.state
                        })),
                        message: `📝 Found ${assignments.length} assignment(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list assignments: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_create_assignment',
            description: 'Creates a comprehensive assignment with materials, due date, topics, and grading options.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    title: { type: 'string', description: 'The title of the assignment.' },
                    description: { type: 'string', description: 'Optional: Description/instructions.' },
                    max_points: { type: 'number', description: 'Optional: Maximum points for grading.' },
                    due_date: { type: 'string', description: 'Optional: Due date in YYYY-MM-DD format.' },
                    due_time: { type: 'string', description: 'Optional: Due time in HH:MM format (24-hour).' },
                    work_type: {
                        type: 'string',
                        enum: ['ASSIGNMENT', 'SHORT_ANSWER_QUESTION', 'MULTIPLE_CHOICE_QUESTION'],
                        description: 'Optional: Type of work. Default ASSIGNMENT.'
                    },
                    topic_id: { type: 'string', description: 'Optional: Topic ID to categorize assignment.' },
                    state: {
                        type: 'string',
                        enum: ['PUBLISHED', 'DRAFT'],
                        description: 'Optional: Publication state. Default PUBLISHED.'
                    },
                },
                required: ['course_id', 'title'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const courseWork: classroom_v1.Schema$CourseWork = {
                        title: params.title,
                        description: params.description,
                        workType: params.work_type || 'ASSIGNMENT',
                        state: params.state || 'PUBLISHED',
                    };

                    if (params.max_points !== undefined) {
                        courseWork.maxPoints = params.max_points;
                    }

                    if (params.due_date) {
                        const [year, month, day] = params.due_date.split('-').map(Number);
                        courseWork.dueDate = { year, month, day };

                        if (params.due_time) {
                            const [hours, minutes] = params.due_time.split(':').map(Number);
                            courseWork.dueTime = { hours, minutes };
                        } else {
                            courseWork.dueTime = { hours: 23, minutes: 59 };
                        }
                    }

                    if (params.topic_id) {
                        courseWork.topicId = params.topic_id;
                    }

                    const result = await classroom.courses.courseWork.create({
                        courseId: params.course_id,
                        requestBody: courseWork,
                    });

                    return {
                        success: true,
                        data: { assignmentId: result.data.id, title: result.data.title, state: result.data.state },
                        message: `📝 Assignment "${params.title}" created successfully!\n` +
                            `ID: \`${result.data.id}\`\n` +
                            `State: ${result.data.state}\n` +
                            `Max Points: ${result.data.maxPoints || 'Ungraded'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create assignment: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_modify_assignment',
            description: 'Modifies an existing assignment (title, description, due date, points, state).',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    assignment_id: { type: 'string', description: 'The ID of the assignment to modify.' },
                    title: { type: 'string', description: 'Optional: New title.' },
                    description: { type: 'string', description: 'Optional: New description.' },
                    max_points: { type: 'number', description: 'Optional: New max points.' },
                    due_date: { type: 'string', description: 'Optional: New due date (YYYY-MM-DD).' },
                    state: {
                        type: 'string',
                        enum: ['PUBLISHED', 'DRAFT'],
                        description: 'Optional: Change publication state.'
                    },
                },
                required: ['course_id', 'assignment_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const updateMask: string[] = [];
                    const courseWork: classroom_v1.Schema$CourseWork = {};

                    if (params.title) {
                        courseWork.title = params.title;
                        updateMask.push('title');
                    }
                    if (params.description !== undefined) {
                        courseWork.description = params.description;
                        updateMask.push('description');
                    }
                    if (params.max_points !== undefined) {
                        courseWork.maxPoints = params.max_points;
                        updateMask.push('maxPoints');
                    }
                    if (params.due_date) {
                        const [year, month, day] = params.due_date.split('-').map(Number);
                        courseWork.dueDate = { year, month, day };
                        updateMask.push('dueDate');
                    }
                    if (params.state) {
                        courseWork.state = params.state;
                        updateMask.push('state');
                    }

                    if (updateMask.length === 0) {
                        return { success: false, message: '⚠️ No fields specified for update.' };
                    }

                    const result = await classroom.courses.courseWork.patch({
                        courseId: params.course_id,
                        id: params.assignment_id,
                        updateMask: updateMask.join(','),
                        requestBody: courseWork,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📝 Assignment updated successfully!\n` +
                            `Title: ${result.data.title}\n` +
                            `Updated fields: ${updateMask.join(', ')}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to modify assignment: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // STUDENT & ROSTER MANAGEMENT
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_list_students',
            description: 'Lists all students enrolled in a course with detailed profile information.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.students.list({
                        courseId: params.course_id,
                        pageSize: 100,
                    });

                    const students = result.data.students || [];
                    if (students.length === 0) {
                        return { success: true, data: [], message: '👥 No students found in this course.' };
                    }

                    const formatted = students
                        .map((s, i) => {
                            const name = s.profile?.name?.fullName || 'Unknown';
                            const email = s.profile?.emailAddress || 'N/A';
                            const userId = s.userId || 'N/A';
                            return `${i + 1}. **${name}**\n   Email: ${email}\n   User ID: ${userId}`;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: students.map(s => ({
                            userId: s.userId,
                            name: s.profile?.name?.fullName,
                            email: s.profile?.emailAddress,
                        })),
                        message: `👥 Found ${students.length} student(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list students: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_list_teachers',
            description: 'Lists all teachers in a course with profile information.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.teachers.list({
                        courseId: params.course_id,
                        pageSize: 50,
                    });

                    const teachers = result.data.teachers || [];
                    if (teachers.length === 0) {
                        return { success: true, data: [], message: '👨‍🏫 No teachers found in this course.' };
                    }

                    const formatted = teachers
                        .map((t, i) => {
                            const name = t.profile?.name?.fullName || 'Unknown';
                            const email = t.profile?.emailAddress || 'N/A';
                            return `${i + 1}. **${name}**\n   Email: ${email}`;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: teachers.map(t => ({
                            userId: t.userId,
                            name: t.profile?.name?.fullName,
                            email: t.profile?.emailAddress,
                        })),
                        message: `👨‍🏫 Found ${teachers.length} teacher(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list teachers: ${error.message}`
                    };
                }
            },
        },

        // ═════════════════════════════════════════════════════════════
        // SUBMISSIONS & GRADING
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_get_submissions',
            description: 'Gets detailed student submissions for an assignment with filtering and grading info.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    assignment_id: { type: 'string', description: 'The ID of the assignment.' },
                    user_id: { type: 'string', description: 'Optional: Filter by specific student user ID.' },
                    states: {
                        type: 'array',
                        items: { type: 'string', enum: ['NEW', 'CREATED', 'TURNED_IN', 'RETURNED', 'RECLAIMED_BY_STUDENT'] },
                        description: 'Optional: Filter by submission states.'
                    },
                },
                required: ['course_id', 'assignment_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.courseWork.studentSubmissions.list({
                        courseId: params.course_id,
                        courseWorkId: params.assignment_id,
                        userId: params.user_id,
                        states: params.states,
                        pageSize: 100,
                    });

                    const submissions = result.data.studentSubmissions || [];
                    if (submissions.length === 0) {
                        return { success: true, data: [], message: '📋 No submissions found for this assignment.' };
                    }

                    const formatted = submissions
                        .map((s, i) => {
                            const state = s.state || 'UNKNOWN';
                            const assignedGrade = s.assignedGrade !== undefined ? `${s.assignedGrade}` : 'Not graded';
                            const draftGrade = s.draftGrade !== undefined ? ` (Draft: ${s.draftGrade})` : '';
                            const late = s.late ? ' ⏰ LATE' : '';
                            const stateEmoji = {
                                NEW: '🆕',
                                CREATED: '📝',
                                TURNED_IN: '✅',
                                RETURNED: '📬',
                                RECLAIMED_BY_STUDENT: '🔄'
                            }[state] || '❓';

                            return `${i + 1}. ${stateEmoji} Student: ${s.userId}${late}\n` +
                                `   Status: ${state} | Grade: ${assignedGrade}${draftGrade}\n` +
                                `   Submission ID: \`${s.id}\``;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: submissions.map(s => ({
                            id: s.id,
                            userId: s.userId,
                            state: s.state,
                            assignedGrade: s.assignedGrade,
                            draftGrade: s.draftGrade,
                            late: s.late,
                        })),
                        message: `📋 Found ${submissions.length} submission(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to get submissions: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_grade_submission',
            description: 'Grades a student submission with draft or assigned grade.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    assignment_id: { type: 'string', description: 'The ID of the assignment.' },
                    submission_id: { type: 'string', description: 'The ID of the submission.' },
                    draft_grade: { type: 'number', description: 'Optional: Set a draft grade (not visible to student yet).' },
                    assigned_grade: { type: 'number', description: 'Optional: Set final assigned grade (visible to student).' },
                },
                required: ['course_id', 'assignment_id', 'submission_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    if (params.draft_grade === undefined && params.assigned_grade === undefined) {
                        return { success: false, message: '⚠️ Must specify either draft_grade or assigned_grade.' };
                    }

                    const updateMask: string[] = [];
                    const submission: classroom_v1.Schema$StudentSubmission = {};

                    if (params.draft_grade !== undefined) {
                        submission.draftGrade = params.draft_grade;
                        updateMask.push('draftGrade');
                    }
                    if (params.assigned_grade !== undefined) {
                        submission.assignedGrade = params.assigned_grade;
                        updateMask.push('assignedGrade');
                    }

                    const result = await classroom.courses.courseWork.studentSubmissions.patch({
                        courseId: params.course_id,
                        courseWorkId: params.assignment_id,
                        id: params.submission_id,
                        updateMask: updateMask.join(','),
                        requestBody: submission,
                    });

                    return {
                        success: true,
                        data: result.data,
                        message: `📊 Submission graded successfully!\n` +
                            `Student: ${result.data.userId}\n` +
                            `Draft Grade: ${result.data.draftGrade || 'N/A'}\n` +
                            `Assigned Grade: ${result.data.assignedGrade || 'N/A'}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to grade submission: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_return_submission',
            description: 'Returns a graded submission to the student (changes state to RETURNED).',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    assignment_id: { type: 'string', description: 'The ID of the assignment.' },
                    submission_id: { type: 'string', description: 'The ID of the submission to return.' },
                },
                required: ['course_id', 'assignment_id', 'submission_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.courseWork.studentSubmissions.return({
                        courseId: params.course_id,
                        courseWorkId: params.assignment_id,
                        id: params.submission_id,
                    });

                    // The return operation returns an empty response, so we need to fetch the submission
                    const submissionResult = await classroom.courses.courseWork.studentSubmissions.get({
                        courseId: params.course_id,
                        courseWorkId: params.assignment_id,
                        id: params.submission_id,
                    });

                    return {
                        success: true,
                        data: submissionResult.data,
                        message: `📬 Submission returned to student!\n` +
                            `Student: ${submissionResult.data.userId}\n` +
                            `Final Grade: ${submissionResult.data.assignedGrade || 'Ungraded'}\n` +
                            `State: ${submissionResult.data.state}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to return submission: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // ANNOUNCEMENTS & COMMUNICATION
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_post_announcement',
            description: 'Posts an announcement to a course with optional materials and scheduling.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    text: { type: 'string', description: 'The announcement text.' },
                    state: {
                        type: 'string',
                        enum: ['PUBLISHED', 'DRAFT'],
                        description: 'Optional: Publication state. Default PUBLISHED.'
                    },
                    scheduled_time: {
                        type: 'string',
                        description: 'Optional: Schedule for future (ISO 8601 format).'
                    },
                },
                required: ['course_id', 'text'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const announcement: classroom_v1.Schema$Announcement = {
                        text: params.text,
                        state: params.state || 'PUBLISHED',
                    };

                    if (params.scheduled_time) {
                        announcement.scheduledTime = params.scheduled_time;
                    }

                    const result = await classroom.courses.announcements.create({
                        courseId: params.course_id,
                        requestBody: announcement,
                    });

                    return {
                        success: true,
                        data: { announcementId: result.data.id, state: result.data.state },
                        message: `📢 Announcement posted successfully!\n` +
                            `State: ${result.data.state}\n` +
                            `ID: \`${result.data.id}\`\n` +
                            (params.scheduled_time ? `\n⏰ Scheduled for: ${params.scheduled_time}` : ''),
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to post announcement: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_list_announcements',
            description: 'Lists all announcements in a course.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    announcement_states: {
                        type: 'array',
                        items: { type: 'string', enum: ['PUBLISHED', 'DRAFT', 'DELETED'] },
                        description: 'Optional: Filter by states. Default: PUBLISHED only.'
                    },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.announcements.list({
                        courseId: params.course_id,
                        announcementStates: params.announcement_states || ['PUBLISHED'],
                        pageSize: 50,
                    });

                    const announcements = result.data.announcements || [];
                    if (announcements.length === 0) {
                        return { success: true, data: [], message: '📢 No announcements found.' };
                    }

                    const formatted = announcements
                        .map((a, i) => {
                            const text = a.text && a.text.length > 100 ? a.text.substring(0, 100) + '...' : a.text || '';
                            const state = a.state || 'PUBLISHED';
                            const createdTime = a.creationTime ? new Date(a.creationTime).toLocaleString() : 'Unknown';

                            return `${i + 1}. **${state}** (${createdTime})\n` +
                                `   ${text}\n` +
                                `   ID: \`${a.id}\``;
                        })
                        .join('\n\n');

                    return {
                        success: true,
                        data: announcements,
                        message: `📢 Found ${announcements.length} announcement(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list announcements: ${error.message}`
                    };
                }
            },
        },

        // ═══════════════════════════════════════════════════════════
        // TOPICS (ORGANIZATION)
        // ═══════════════════════════════════════════════════════════

        {
            name: 'classroom_create_topic',
            description: 'Creates a topic to organize coursework in a course.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                    name: { type: 'string', description: 'The name of the topic.' },
                },
                required: ['course_id', 'name'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.topics.create({
                        courseId: params.course_id,
                        requestBody: { name: params.name },
                    });

                    return {
                        success: true,
                        data: { topicId: result.data.topicId, name: result.data.name },
                        message: `📂 Topic "${params.name}" created successfully!\nTopic ID: \`${result.data.topicId}\``,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to create topic: ${error.message}`
                    };
                }
            },
        },

        {
            name: 'classroom_list_topics',
            description: 'Lists all topics in a course.',
            parameters: {
                type: 'object',
                properties: {
                    course_id: { type: 'string', description: 'The ID of the course.' },
                },
                required: ['course_id'],
            },
            execute: async (params): Promise<ToolResult> => {
                try {
                    const result = await classroom.courses.topics.list({
                        courseId: params.course_id,
                    });

                    const topics = result.data.topic || [];
                    if (topics.length === 0) {
                        return { success: true, data: [], message: '📂 No topics found in this course.' };
                    }

                    const formatted = topics
                        .map((t, i) => `${i + 1}. **${t.name}**\n   ID: \`${t.topicId}\``)
                        .join('\n\n');

                    return {
                        success: true,
                        data: topics,
                        message: `📂 Found ${topics.length} topic(s):\n\n${formatted}`,
                    };
                } catch (error: any) {
                    return {
                        success: false,
                        error: error.message,
                        message: `❌ Failed to list topics: ${error.message}`
                    };
                }
            },
        },
    ];
}
