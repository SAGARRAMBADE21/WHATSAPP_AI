import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);

const V0_SCRIPT = path.resolve(__dirname, "../../skills/v0skill/scripts/v0_platform.mjs");

/**
 * Runs the v0_platform.mjs script with the given arguments
 */
async function runV0Command(command: string, ...args: string[]): Promise<string> {
  try {
    // Quote arguments to prevent shell injection issues
    const safeArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ");
    const { stdout, stderr } = await execAsync(`node "${V0_SCRIPT}" ${command} ${safeArgs}`, {
      env: { ...process.env },
    });
    return stdout || stderr;
  } catch (error: any) {
    return error.stdout || error.stderr || error.message;
  }
}

/**
 * Tool Definitions for OpenAI
 */
export const v0Tools = [
  {
    type: "function",
    function: {
      name: "v0_create_chat",
      description: "Send a prompt to Vercel v0 to generate UI components, websites, or apps. Returns a preview URL.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "What to build (e.g. 'A sleek dashboard UI')." },
          project_id: { type: "string", description: "Optional project ID to continue working on." }
        },
        required: ["prompt"]
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
      name: "v0_deploy",
      description: "Deploy a v0 project to Vercel.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          chat_id: { type: "string" },
          version_id: { type: "string" }
        },
        required: ["project_id", "chat_id", "version_id"]
      }
    }
  }
];

export async function handleV0ToolCall(toolCall: any): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  console.log(`[V0 Tool] Executing ${name} with payload:`, args);

  switch (name) {
    case "v0_create_chat":
      if (args.project_id) {
        return await runV0Command("create-chat", args.prompt, "--project", args.project_id);
      }
      return await runV0Command("create-chat", args.prompt);

    case "v0_list_projects":
      return await runV0Command("list-projects");

    case "v0_deploy":
      return await runV0Command("deploy", args.project_id, args.chat_id, args.version_id);

    default:
      return "Unknown V0 command.";
  }
}
