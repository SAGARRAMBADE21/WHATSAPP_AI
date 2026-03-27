import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);

// Path to the python script inside the manus skill folder
const MANUS_SCRIPT = path.resolve(__dirname, "../../skills/manus-computer/manus skill/manus/scripts/manus.py");

/**
 * Runs the manus.py script with the given arguments
 */
async function runManusCommand(args: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`python "${MANUS_SCRIPT}" ${args}`, {
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
export const manusTools = [
  {
    type: "function",
    function: {
      name: "manus_send_task",
      description: "Send a complex task to the Manus AI cloud to analyze and execute (hybrid mode or cloud only).",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The task for Manus AI to perform." },
          mode: { type: "string", enum: ["agent", "chat", "adaptive"], description: "Execution mode." }
        },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manus_hybrid",
      description: "Run a task in Hybrid Mode — Manus plans in the cloud, local machine executes.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The task to perform." }
        },
        required: ["prompt"]
      }
    }
  },
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
      name: "manus_list_tasks",
      description: "List recent tasks sent to Manus AI.",
      parameters: { type: "object", properties: {} }
    }
  }
];

export async function handleManusToolCall(toolCall: any): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

  console.log(`[Manus Tool] Executing ${name} with payload:`, args);

  switch (name) {
    case "manus_send_task":
      const modeFlag = args.mode ? `--mode ${args.mode}` : "";
      return await runManusCommand(`send "${args.prompt}" ${modeFlag}`);
      
    case "manus_hybrid":
      return await runManusCommand(`hybrid "${args.prompt}"`);

    case "manus_desktop_screenshot":
      // Send directly back since it will just output a path or success text
      return await runManusCommand(`desktop-screenshot`);

    case "manus_list_tasks":
      return await runManusCommand(`tasks`);

    default:
      return "Unknown Manus command.";
  }
}
