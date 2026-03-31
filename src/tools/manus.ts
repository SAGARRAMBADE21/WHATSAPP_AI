import dotenv from "dotenv";

dotenv.config();

const MANUS_BASE_URL = process.env.MANUS_BASE_URL || "https://api.manus.ai/v1";

async function manusApi(method: string, apiPath: string, apiKey: string, body?: any): Promise<any> {
  const url = `${MANUS_BASE_URL}${apiPath}`;
  const options: RequestInit = {
    method,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": apiKey,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (response.status === 204) return null;

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Manus API returned non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`Manus API error ${response.status}: ${JSON.stringify(data).substring(0, 300)}`);
  }
  return data;
}

async function pollTask(taskId: string, apiKey: string): Promise<string> {
  let output = "";

  // Poll for up to 120 seconds
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const task = await manusApi("GET", `/tasks/${taskId}`, apiKey);
      let current = "";
      for (const item of (task.output || [])) {
        if (item.role !== "assistant") continue;
        for (const c of (item.content || [])) {
          if (c.text) current += c.text;
        }
      }
      output = current;

      const status = task.status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        const title = task.metadata?.task_title || "";
        const taskUrl = task.metadata?.task_url || "";
        let result = title ? `${title}\n` : "";
        result += `Status: ${status}`;
        if (taskUrl) result += `\nURL: ${taskUrl}`;
        if (output) result += `\n\n${output}`;
        return result;
      }
    } catch {
      // Network blip, continue polling
    }
  }

  return output || "Task is still running. Check back later.";
}

async function runManusCommand(apiKey: string | undefined, command: string, ...args: string[]): Promise<string> {
  if (!apiKey) return "Error: Manus API key not configured. Add it in the dashboard settings.";

  try {
    switch (command) {
      case "send": {
        const prompt = args[0];
        const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "agent";
        const body: any = { prompt, agent_profile: "manus-1.6", task_mode: mode };
        const resp = await manusApi("POST", "/tasks", apiKey, body);
        if (!resp) return "Failed to create task.";
        return await pollTask(resp.task_id, apiKey);
      }

      case "hybrid": {
        const body = { prompt: args[0], agent_profile: "manus-1.6", task_mode: "hybrid" };
        const resp = await manusApi("POST", "/tasks", apiKey, body);
        if (!resp) return "Failed to create hybrid task.";
        return await pollTask(resp.task_id, apiKey);
      }

      case "tasks": {
        const limit = args.includes("--limit") ? args[args.indexOf("--limit") + 1] : "20";
        const data = await manusApi("GET", `/tasks?limit=${limit}`, apiKey);
        const tasks = data?.data || [];
        if (tasks.length === 0) return "No tasks found.";
        return `Found ${tasks.length} task(s):\n` +
          tasks.map((t: any) => `  ${t.id} | ${t.status} | ${t.metadata?.task_title || "(untitled)"}`).join("\n");
      }

      case "task": {
        const task = await manusApi("GET", `/tasks/${args[0]}`, apiKey);
        if (!task) return "Task not found.";
        let output = "";
        for (const item of (task.output || [])) {
          if (item.role !== "assistant") continue;
          for (const c of (item.content || [])) {
            if (c.text?.trim()) output += c.text.trim() + "\n";
          }
        }
        const title = task.metadata?.task_title || "";
        return `${title ? title + "\n" : ""}Status: ${task.status}\n${output || "(no output yet)"}`;
      }

      case "projects": {
        const data = await manusApi("GET", "/projects", apiKey);
        const projects = data?.data || [];
        if (projects.length === 0) return "No projects found.";
        return `Found ${projects.length} project(s):\n` +
          projects.map((p: any) => `  ${p.id} | ${p.name || "(unnamed)"}`).join("\n");
      }

      case "exec": {
        // Local execution is not supported in cloud deployment
        return "Local shell execution is not available in cloud deployment. Use the E2B sandbox instead.";
      }

      case "file-list": {
        return "Local file listing is not available in cloud deployment. Use the E2B sandbox instead.";
      }

      case "file-read": {
        return "Local file reading is not available in cloud deployment. Use the E2B sandbox instead.";
      }

      case "desktop-screenshot":
      case "desktop-apps":
      case "desktop-sysinfo": {
        return "Desktop control is not available in cloud deployment.";
      }

      default:
        return `Unknown Manus command: ${command}`;
    }
  } catch (error: any) {
    return error.message || String(error);
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

  // 3. Local Execution (redirects to E2B sandbox in cloud)
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
      return await runManusCommand(apiKey, "desktop-screenshot");
    case "manus_desktop_apps":
      return await runManusCommand(apiKey, "desktop-apps");
    case "manus_desktop_sysinfo":
      return await runManusCommand(apiKey, "desktop-sysinfo");

    default:
      return "Unknown Manus command.";
  }
}
