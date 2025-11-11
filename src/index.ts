import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// ---- Auth token (Option 2: environment) -----------------------------------
const AUTH_TOKEN = process.env.THINGS_AUTH_TOKEN || "";

// --- helpers ---------------------------------------------------------------

async function runAppleScript(source: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-l", "AppleScript", "-e", source]);
  return stdout.trim();
}

function percentEncode(obj: Record<string, string | number | boolean | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    p.set(k, String(v));
  }
  return p.toString();
}

async function openThingsUrl(command: string, params: Record<string, any>) {
  const url = `things:///${command}?${percentEncode(params)}`;
  await execFileAsync("open", [url]); // let macOS handle the URL scheme
  return { ok: true, url };
}

// --- AppleScript -> TSV -> JSON -------------------------------------------

function parseTSV(tsv: string, fields: string[]) {
  if (!tsv) return [];
  return tsv.split("\n").filter(Boolean).map(line => {
    const cells = line.split("\t");
    const obj: any = {};
    fields.forEach((f, i) => (obj[f] = cells[i] ?? ""));
    return obj;
  });
}

async function listBuiltIn(builtin: "Inbox" | "Today" | "Anytime" | "Upcoming" | "Someday") {
  const script = `
    use AppleScript version "2.4"
    use scripting additions
    set outLines to {}
    tell application "Things3"
      repeat with t in to dos of list "${builtin}"
        set end of outLines to (id of t as text) & tab & (name of t as text) & tab & (status of t as text) & tab & (notes of t as text) & tab & my maybeDate(due date of t) & tab & my maybeDate(start date of t)
      end repeat
    end tell
    on maybeDate(d)
      if d is missing value then return ""
      return (d as «class isot» as string)
    end maybeDate
    return outLines as text
  `;
  const raw = await runAppleScript(script);
  const fields = ["id", "title", "status", "notes", "dueISO", "startISO"];
  return parseTSV(raw, fields);
}

async function listAreas() {
  const script = `
    use AppleScript version "2.4"
    use scripting additions
    set outLines to {}
    tell application "Things3"
      repeat with a in areas
        set end of outLines to (id of a as text) & tab & (name of a as text)
      end repeat
    end tell
    return outLines as text
  `;
  const raw = await runAppleScript(script);
  return parseTSV(raw, ["id", "name"]);
}

async function listProjects(areaId?: string) {
  const byArea = areaId ? `
    set theArea to area id "${areaId}"
    repeat with p in projects of theArea
      set end of outLines to (id of p as text) & tab & (name of p as text) & tab & (status of p as text)
    end repeat
  ` : `
    repeat with p in projects
      set end of outLines to (id of p as text) & tab & (name of p as text) & tab & (status of p as text)
    end repeat
  `;
  const script = `
    use AppleScript version "2.4"
    use scripting additions
    set outLines to {}
    tell application "Things3"
      ${byArea}
    end tell
    return outLines as text
  `;
  const raw = await runAppleScript(script);
  return parseTSV(raw, ["id", "name", "status"]);
}

async function listProjectTodos(projectId: string) {
  const script = `
    use AppleScript version "2.4"
    use scripting additions
    set outLines to {}
    tell application "Things3"
      set theProj to project id "${projectId}"
      repeat with t in to dos of theProj
        set end of outLines to (id of t as text) & tab & (name of t as text) & tab & (status of t as text) & tab & (notes of t as text) & tab & my maybeDate(due date of t) & tab & my maybeDate(start date of t)
      end repeat
    end tell
    on maybeDate(d)
      if d is missing value then return ""
      return (d as «class isot» as string)
    end maybeDate
    return outLines as text
  `;
  const raw = await runAppleScript(script);
  const fields = ["id", "title", "status", "notes", "dueISO", "startISO"];
  return parseTSV(raw, fields);
}

async function createTodoAppleScript(input: {
  title: string;
  notes?: string;
  when?: string;
  deadline?: string;
  projectId?: string;
  areaId?: string;
  tags?: string[];
}) {
  const tagList = (input.tags ?? []).map(t => `"${t.replace(/"/g, '\\"')}"`).join(", ");
  const setTags = input.tags && input.tags.length ? `set tag names of newToDo to {${tagList}}` : "";
  const container =
    input.projectId
      ? `at beginning of project id "${input.projectId}"`
      : input.areaId
        ? `at beginning of area id "${input.areaId}"`
        : `at beginning of list "Inbox"`;

  const setWhen = input.when
    ? (input.when.toLowerCase() === "today"
        ? `move newToDo to list "Today"`
        : input.when.toLowerCase() === "evening"
          ? `move newToDo to list "Evening"`
          : input.when.toLowerCase() === "tomorrow"
            ? `set start date of newToDo to (current date) + (1 * days)`
            : `try
                 set start date of newToDo to date "${input.when}"
               end try`)
    : "";

  const setDeadline = input.deadline ? `try set due date of newToDo to date "${input.deadline}" end try` : "";

  const titleEsc = input.title.replace(/"/g, '\\"');
  const notesEsc = (input.notes ?? "").replace(/"/g, '\\"');

  const script = `
    use AppleScript version "2.4"
    use scripting additions
    tell application "Things3"
      set newToDo to make new to do with properties {name:"${titleEsc}", notes:"${notesEsc}"} ${container}
      ${setWhen}
      ${setDeadline}
      ${setTags}
      set theId to id of newToDo as text
    end tell
    return theId
  `;
  const id = await runAppleScript(script);
  return id;
}

async function setStatusById(id: string, status: "completed" | "canceled") {
  const script = `
    tell application "Things3"
      set t to to do id "${id}"
      set status of t to ${status}
    end tell
    return "ok"
  `;
  await runAppleScript(script);
  return { ok: true };
}

// --- MCP server ------------------------------------------------------------

const server = new McpServer({
  name: "things-mcp",
  version: "0.2.0"
});

// list_areas
server.tool(
  "things_list_areas",
  "List all Things areas (id, name).",
  {},
  async () => {
    const areas = await listAreas();
    return { content: [{ type: "text", text: JSON.stringify(areas, null, 2) }] };
  }
);

// list_projects
server.tool(
  "things_list_projects",
  "List projects, optionally filtered by areaId.",
  {
    areaId: z.string().optional().describe("Optional area ID to filter projects")
  },
  async ({ areaId }) => {
    const projects = await listProjects(areaId);
    return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
  }
);

// list_todos
server.tool(
  "things_list_todos",
  "List to-dos from a built-in list (Inbox, Today, Anytime, Upcoming, Someday) or from a projectId.",
  {
    builtIn: z.enum(["Inbox", "Today", "Anytime", "Upcoming", "Someday"]).optional().describe("Built-in list name"),
    projectId: z.string().optional().describe("Project ID to list todos from")
  },
  async ({ builtIn, projectId }) => {
    if (!builtIn && !projectId) {
      throw new Error("Provide either builtIn or projectId");
    }
    const rows = builtIn ? await listBuiltIn(builtIn) : await listProjectTodos(projectId!);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

// create_todo
server.tool(
  "things_create_todo",
  "Create a to-do. Returns the new Things ID.",
  {
    title: z.string().describe("Title of the to-do"),
    notes: z.string().optional().describe("Notes for the to-do"),
    when: z.string().optional().describe("When to schedule (today, evening, tomorrow, or date)"),
    deadline: z.string().optional().describe("Deadline date"),
    projectId: z.string().optional().describe("Project ID to add to"),
    areaId: z.string().optional().describe("Area ID to add to"),
    tags: z.array(z.string()).optional().describe("Tags to apply")
  },
  async (input) => {
    const id = await createTodoAppleScript(input);
    return { content: [{ type: "text", text: JSON.stringify({ id }, null, 2) }] };
  }
);

// create_project (no auth needed for basic add-project)
server.tool(
  "things_create_project",
  "Create a project via Things URL scheme.",
  {
    title: z.string().describe("Project title"),
    notes: z.string().optional().describe("Project notes"),
    when: z.string().optional().describe("When to schedule"),
    deadline: z.string().optional().describe("Project deadline"),
    area: z.string().optional().describe("Area name"),
    reveal: z.boolean().optional().default(false).describe("Show in Things after creation")
  },
  async ({ title, notes, when, deadline, area, reveal }) => {
    const params = { title, notes, when, deadline, area, reveal: !!reveal };
    const out = await openThingsUrl("add-project", params);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// update_item (uses env token by default; explicit input overrides if provided)
server.tool(
  "things_update_item",
  "Update a to-do or project by id via Things URL scheme. Uses THINGS_AUTH_TOKEN from env; you may override by passing authToken.",
  {
    authToken: z.string().optional().describe("Override auth token"),
    id: z.string().describe("Item ID to update"),
    title: z.string().optional().describe("New title"),
    notes: z.string().optional().describe("New notes"),
    addTags: z.array(z.string()).optional().describe("Tags to add"),
    tags: z.array(z.string()).optional().describe("Replace all tags"),
    when: z.string().optional().describe("New schedule"),
    deadline: z.string().optional().describe("New deadline"),
    listId: z.string().optional().describe("Move to list ID"),
    reveal: z.boolean().optional().describe("Show in Things"),
    duplicate: z.boolean().optional().describe("Duplicate item"),
    completed: z.boolean().optional().describe("Mark as completed"),
    canceled: z.boolean().optional().describe("Mark as canceled"),
    isProject: z.boolean().optional().default(false).describe("Is this a project (not a to-do)")
  },
  async (input) => {
    const token = input.authToken || AUTH_TOKEN;
    if (!token) {
      throw new Error(
        "Missing Things auth token. Set THINGS_AUTH_TOKEN in the MCP server env or pass authToken explicitly."
      );
    }
    const cmd = input.isProject ? "update-project" : "update";
    const params: Record<string, any> = {
      "auth-token": token,
      id: input.id,
      title: input.title,
      notes: input.notes,
      when: input.when,
      deadline: input.deadline,
      "list-id": input.listId,
      reveal: input.reveal,
      duplicate: input.duplicate,
      completed: input.completed,
      canceled: input.canceled
    };
    if (input.addTags) params["add-tags"] = input.addTags.join(",");
    if (input.tags) params["tags"] = input.tags.join(",");
    const out = await openThingsUrl(cmd, params);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// show
server.tool(
  "things_show",
  "Open Things to a specific item or view.",
  {
    id: z.string().optional().describe("Item ID to show"),
    filter: z.string().optional().describe("Filter to apply"),
    query: z.string().optional().describe("Query to search")
  },
  async ({ id, filter, query }) => {
    const out = await openThingsUrl("show", { id, filter, query });
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// search
server.tool(
  "things_search",
  "Open Things and run a search query in the UI.",
  {
    query: z.string().describe("Search query")
  },
  async ({ query }) => {
    const out = await openThingsUrl("search", { query });
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// complete / cancel via AppleScript
server.tool(
  "things_complete",
  "Mark a to-do as completed by ID (AppleScript).",
  {
    id: z.string().describe("To-do ID to complete")
  },
  async ({ id }) => {
    const out = await setStatusById(id, "completed");
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

server.tool(
  "things_cancel",
  "Mark a to-do as canceled by ID (AppleScript).",
  {
    id: z.string().describe("To-do ID to cancel")
  },
  async ({ id }) => {
    const out = await setStatusById(id, "canceled");
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  }
);

// boot
const transport = new StdioServerTransport();
await server.connect(transport);