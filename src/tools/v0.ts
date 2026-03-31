import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const V0_SCRIPT = path.resolve(process.cwd(), "skills/v0skill/scripts/v0_platform.mjs");

async function runV0Command(apiKey: string | undefined, command: string, ...args: string[]): Promise<string> {
  try {
    const safeArgs = args.map(arg => {
      if (arg === undefined || arg === null) return "";
      return `"${String(arg).replace(/"/g, '\\"')}"`;
    }).join(" ");
    
    const env = { ...process.env };
    if (apiKey) env.V0_API_KEY = apiKey;

    const { stdout, stderr } = await execAsync(`node "${V0_SCRIPT}" ${command} ${safeArgs}`, {
      env
    });
    return stdout || stderr;
  } catch (error: any) {
    return error.stdout || error.stderr || error.message;
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
      return await runV0Command(apiKey, "delete-project", args.project_id, "--confirm");

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
      return await runV0Command(apiKey, "delete-chat", args.chat_id, "--confirm");
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
