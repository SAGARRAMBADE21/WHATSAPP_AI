import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);
const MANUS_SCRIPT = path.resolve(process.cwd(), "skills/manus-computer/manus skill/manus/scripts/manus.py");

async function runManusCommand(apiKey: string | undefined, command: string, ...args: string[]): Promise<string> {
  try {
    const safeArgs = args.map(arg => {
      if (arg === undefined || arg === null) return "";
      return `"${String(arg).replace(/"/g, '\\"')}"`;
    }).join(" ");
    
    const env = { ...process.env };
    if (apiKey) env.MANUS_API_KEY = apiKey;

    const { stdout, stderr } = await execAsync(`python "${MANUS_SCRIPT}" ${command} ${safeArgs}`, {
      env
    });
    return stdout || stderr;
  } catch (error: any) {
    return error.stdout || error.stderr || error.message;
  }
}

export const manusTools = [
  // 1. Cloud AI
  {
    type: "function",
    function: {
      name: "manus_send",
      description: "Send a prompt to the Manus AI cloud to analyze and execute.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" }, mode: { type: "string", enum: ["agent", "chat", "adaptive"] } },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_hybrid",
      description: "Run a task in Hybrid Mode — Manus plans in the cloud, but controls the local machine.",
      parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] }
    }
  },

  // 2. Tasks & Projects
  {
    type: "function",
    function: {
      name: "manus_tasks",
      description: "List recent tasks sent to Manus AI.",
      parameters: { type: "object", properties: { limit: { type: "number" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_get_task",
      description: "View the output of a specific Manus task.",
      parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_projects",
      description: "List Manus projects.",
      parameters: { type: "object", properties: {} }
    }
  },

  // 3. Local Execution
  {
    type: "function",
    function: {
      name: "manus_exec",
      description: "Execute a shell command locally on the computer using Manus.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_file_list",
      description: "List files in a local directory.",
      parameters: { type: "object", properties: { dir_path: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_file_read",
      description: "Read the contents of a local file.",
      parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] }
    }
  },

  // 4. Desktop Control
  {
    type: "function",
    function: {
      name: "manus_desktop_screenshot",
      description: "Take a screenshot of the local computer desktop.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_desktop_apps",
      description: "List all running applications on the computer.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_desktop_sysinfo",
      description: "Get basic system information (CPU, RAM, OS).",
      parameters: { type: "object", properties: {} }
    }
  }
];

export async function handleManusToolCall(toolCall: any, apiKey?: string): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  console.log(`[Manus Tool] Executing ${name} with payload:`, args);

  switch (name) {
    // Cloud
    case "manus_send":
      if (args.mode) return await runManusCommand(apiKey, "send", args.prompt, "--mode", args.mode);
      return await runManusCommand(apiKey, "send", args.prompt);
    case "manus_hybrid":
      return await runManusCommand(apiKey, "hybrid", args.prompt);

    // Tasks & Projects
    case "manus_tasks":
      if (args.limit) return await runManusCommand(apiKey, "tasks", "--limit", args.limit.toString());
      return await runManusCommand(apiKey, "tasks");
    case "manus_get_task":
      return await runManusCommand(apiKey, "task", args.task_id);
    case "manus_projects":
      return await runManusCommand(apiKey, "projects");

    // Local execution
    case "manus_exec":
      return await runManusCommand(apiKey, "exec", args.command);
    case "manus_file_list":
      if (args.dir_path) return await runManusCommand(apiKey, "file-list", args.dir_path);
      return await runManusCommand(apiKey, "file-list");
    case "manus_file_read":
      return await runManusCommand(apiKey, "file-read", args.file_path);

    // Desktop
    case "manus_desktop_screenshot":
      // Send directly back since it outputs path or success
      return await runManusCommand(apiKey, "desktop-screenshot");
    case "manus_desktop_apps":
      return await runManusCommand(apiKey, "desktop-apps");
    case "manus_desktop_sysinfo":
      return await runManusCommand(apiKey, "desktop-sysinfo");

    default:
      return "Unknown Manus command.";
  }
}
