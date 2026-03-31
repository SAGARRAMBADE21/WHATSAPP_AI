import dotenv from "dotenv";

dotenv.config();

const V0_BASE_URL = process.env.V0_BASE_URL || "https://api.v0.dev/v1";

async function v0Api(method: string, apiPath: string, apiKey: string, body?: any): Promise<any> {
  const url = `${V0_BASE_URL}${apiPath}`;
  const options: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (response.status === 204) return null;

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`API returned non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    const errMsg = data?.error?.userMessage || data?.error?.message || JSON.stringify(data);
    throw new Error(`v0 API error ${response.status}: ${errMsg}`);
  }
  return data;
}

async function runV0Command(apiKey: string | undefined, command: string, ...args: string[]): Promise<string> {
  if (!apiKey) return "Error: V0 API key not configured. Add it in the dashboard settings.";

  try {
    switch (command) {
      case "list-projects": {
        const data = await v0Api("GET", "/projects", apiKey);
        const projects = Array.isArray(data) ? data : (data.data || data.projects || []);
        if (projects.length === 0) return "No projects found.";
        return `Found ${projects.length} project(s):\n` +
          projects.map((p: any) => `  ${p.name || "Untitled"} (ID: ${p.id})${p.url ? `\n    URL: ${p.url}` : ""}`).join("\n");
      }

      case "create-project": {
        const body: any = { name: args[0] };
        if (args[1]) body.description = args[1];
        const data = await v0Api("POST", "/projects", apiKey, body);
        return `Project created: ${data.name} (ID: ${data.id})${data.url ? `\nURL: ${data.url}` : ""}`;
      }

      case "get-project": {
        const data = await v0Api("GET", `/projects/${encodeURIComponent(args[0])}`, apiKey);
        return `Project: ${data.name || "Untitled"} (ID: ${data.id})${data.url ? `\nURL: ${data.url}` : ""}`;
      }

      case "delete-project": {
        await v0Api("DELETE", `/projects/${encodeURIComponent(args[0])}`, apiKey);
        return `Project ${args[0]} deleted.`;
      }

      case "create-chat": {
        const body: any = { message: args[0] };
        // Parse optional flags from remaining args
        for (let i = 1; i < args.length; i++) {
          if (args[i] === "--project" && args[i + 1]) { body.projectId = args[++i]; }
          else if (args[i] === "--model" && args[i + 1]) { body.modelConfiguration = { modelId: args[++i] }; }
          else if (args[i] === "--privacy" && args[i + 1]) { body.chatPrivacy = args[++i]; }
        }
        const data = await v0Api("POST", "/chats", apiKey, body);
        let result = `Chat created (ID: ${data.id})`;
        if (data.webUrl) result += `\nWeb URL: ${data.webUrl}`;
        if (data.latestVersion?.demoUrl) result += `\nPreview: ${data.latestVersion.demoUrl}`;
        if (data.demo) result += `\nDemo: ${data.demo}`;
        if (data.files?.length > 0) {
          result += `\nGenerated ${data.files.length} file(s): ${data.files.map((f: any) => f.name).join(", ")}`;
        }
        return result;
      }

      case "send-message": {
        const data = await v0Api("POST", `/chats/${encodeURIComponent(args[0])}/messages`, apiKey, { message: args[1] });
        let result = `Message sent to chat ${args[0]}`;
        if (data.content) result += `\n\n--- AI Response ---\n${data.content}`;
        if (data.files?.length > 0) {
          result += `\nUpdated ${data.files.length} file(s): ${data.files.map((f: any) => f.name).join(", ")}`;
        }
        return result;
      }

      case "get-files": {
        const data = await v0Api("GET", `/chats/${encodeURIComponent(args[0])}/messages`, apiKey);
        const seenNames = new Set<string>();
        const allFiles: any[] = [];
        const messages = Array.isArray(data) ? data : (data.messages || []);
        const topFiles = Array.isArray(data) ? [] : (data.files || []);
        for (const msg of messages) {
          if (msg.files) for (const f of msg.files) {
            if (!seenNames.has(f.name)) { seenNames.add(f.name); allFiles.push(f); }
          }
        }
        for (const f of topFiles) {
          if (!seenNames.has(f.name)) { seenNames.add(f.name); allFiles.push(f); }
        }
        if (allFiles.length === 0) return "No files found in this chat.";
        return `Found ${allFiles.length} file(s):\n\n` +
          allFiles.map((f: any) => `--- ${f.name} ---\n${f.content || "(no content)"}\n`).join("\n");
      }

      case "delete-chat": {
        await v0Api("DELETE", `/chats/${encodeURIComponent(args[0])}`, apiKey);
        return `Chat ${args[0]} deleted.`;
      }

      case "list-chats": {
        const data = await v0Api("GET", "/chats", apiKey);
        const chats = Array.isArray(data) ? data : (data.data || data.chats || []);
        if (chats.length === 0) return "No chats found.";
        return `Found ${chats.length} chat(s):\n` +
          chats.map((c: any) => `  ${c.title || c.id} (ID: ${c.id})${c.webUrl ? `\n    URL: ${c.webUrl}` : ""}`).join("\n");
      }

      case "deploy": {
        const data = await v0Api("POST", "/deployments", apiKey, {
          projectId: args[0], chatId: args[1], versionId: args[2]
        });
        return `Deployed (ID: ${data.id})${data.url ? `\nURL: ${data.url}` : ""}`;
      }

      case "vercel-list": {
        const data = await v0Api("GET", "/integrations/vercel/projects", apiKey);
        const projects = Array.isArray(data) ? data : (data.projects || []);
        if (projects.length === 0) return "No Vercel integration projects found.";
        return `Found ${projects.length} Vercel project(s):\n` +
          projects.map((p: any) => `  ${p.name || p.id}${p.url ? `\n    URL: ${p.url}` : ""}`).join("\n");
      }

      case "rate-limits": {
        const data = await v0Api("GET", "/rate-limits", apiKey);
        let result = "Rate Limits:";
        if (data.limit !== undefined) result += `\n  Limit: ${data.limit}`;
        if (data.remaining !== undefined) result += `\n  Remaining: ${data.remaining}`;
        if (data.reset) result += `\n  Resets: ${data.reset}`;
        return result;
      }

      default:
        return `Unknown v0 command: ${command}`;
    }
  } catch (error: any) {
    return error.message || String(error);
  }
}

export const v0Tools = [
  // 1. Projects
  {
    type: "function",
    function: {
      name: "v0_create_project",
      description: "Create a new v0 project.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" } },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_list_projects",
      description: "List all your v0 projects and their IDs.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_get_project",
      description: "Get details of a specific v0 project.",
      parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_delete_project",
      description: "Delete a v0 project.",
      parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"] }
    }
  },

  // 2. Chats
  {
    type: "function",
    function: {
      name: "v0_create_chat",
      description: "Start a new v0 chat to generate UI components or apps. Returns the generated preview URL and chat ID.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          project_id: { type: "string" },
          model: { type: "string" },
          privacy: { type: "string", enum: ["private", "team", "public"] }
        },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_send_message",
      description: "Send a follow-up message to an existing v0 chat.",
      parameters: {
        type: "object",
        properties: { chat_id: { type: "string" }, message: { type: "string" } },
        required: ["chat_id", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_get_files",
      description: "Get the raw generated code files from a v0 chat.",
      parameters: { type: "object", properties: { chat_id: { type: "string" } }, required: ["chat_id"] }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_delete_chat",
      description: "Delete a v0 chat/thread permanently. Use this when the user wants to remove or delete a specific v0 chat.",
      parameters: { type: "object", properties: { chat_id: { type: "string", description: "The ID of the v0 chat to delete" } }, required: ["chat_id"] }
    }
  },
  {
    type: "function",
    function: {
      name: "v0_list_chats",
      description: "List all your v0 chats/threads with their IDs. Use this to find a chat ID before deleting.",
      parameters: { type: "object", properties: {} }
    }
  },

  // 3. Deployments
  {
    type: "function",
    function: {
      name: "v0_deploy",
      description: "Deploy a v0 project to Vercel.",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" }, chat_id: { type: "string" }, version_id: { type: "string" } },
        required: ["project_id", "chat_id", "version_id"]
      }
    }
  },

  // 4. Vercel Integration
  {
    type: "function",
    function: {
      name: "v0_vercel_list",
      description: "List Vercel integration projects linked to v0.",
      parameters: { type: "object", properties: {} }
    }
  },

  // 5. Account
  {
    type: "function",
    function: {
      name: "v0_rate_limits",
      description: "Check your v0 API rate limits and remaining credits.",
      parameters: { type: "object", properties: {} }
    }
  }
];

export async function handleV0ToolCall(toolCall: any, apiKey?: string): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  console.log(`[V0 Tool] Executing ${name} with payload:`, args);

  switch (name) {
    case "v0_create_project":
      return await runV0Command(apiKey, "create-project", args.name, args.description || "");
    case "v0_list_projects":
      return await runV0Command(apiKey, "list-projects");
    case "v0_get_project":
      return await runV0Command(apiKey, "get-project", args.project_id);
    case "v0_delete_project":
      return await runV0Command(apiKey, "delete-project", args.project_id);

    case "v0_create_chat":
      const chatArgs = [args.prompt];
      if (args.project_id) chatArgs.push("--project", args.project_id);
      if (args.model) chatArgs.push("--model", args.model);
      if (args.privacy) chatArgs.push("--privacy", args.privacy);
      return await runV0Command(apiKey, "create-chat", ...chatArgs);

    case "v0_send_message":
      return await runV0Command(apiKey, "send-message", args.chat_id, args.message);
    case "v0_get_files":
      return await runV0Command(apiKey, "get-files", args.chat_id);
    case "v0_delete_chat":
      return await runV0Command(apiKey, "delete-chat", args.chat_id);
    case "v0_list_chats":
      return await runV0Command(apiKey, "list-chats");

    case "v0_deploy":
      return await runV0Command(apiKey, "deploy", args.project_id, args.chat_id, args.version_id);

    case "v0_vercel_list":
      return await runV0Command(apiKey, "vercel-list");

    case "v0_rate_limits":
      return await runV0Command(apiKey, "rate-limits");

    default:
      return "Unknown V0 command.";
  }
}
