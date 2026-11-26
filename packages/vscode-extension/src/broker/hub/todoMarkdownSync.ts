import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  HubTodoItem,
  HubTodoStatus,
  ClarificationQuestion,
} from "./index";
import type { PlaybookStore } from "./playbookStore";

export const STATUS_TO_CHECKBOX: Record<HubTodoStatus, string> = {
  needs_clarification: "?",
  ready: " ",
  in_progress: "/",
  awaiting_approval: "!",
  done: "x",
};

export const CHECKBOX_TO_STATUS: Record<string, HubTodoStatus> = {
  "?": "needs_clarification",
  " ": "ready",
  "/": "in_progress",
  "!": "awaiting_approval",
  "x": "done",
  "X": "done",
};

export const CHECKLIST_LINE_REGEX = /^(\s*[-*]\s*\[)([ ?/!xX])(\]\s+)(.*?)(?:\s+\^(tsk-[a-zA-Z0-9_-]+))?\s*$/;

let _sharedHub: any;
function getSharedHub(): any {
  if (!_sharedHub) {
    try {
      _sharedHub = require(path.join(__dirname, "..", "shared-hub.js"));
    } catch {
      try {
        _sharedHub = require("../../../../shared/hub");
      } catch {
        _sharedHub = undefined;
      }
    }
  }
  return _sharedHub;
}

export function generateDeterministicBlockId(title: string, lineIndex = 0): string {
  const hash = crypto.createHash("sha256").update(`${title.trim()}#${lineIndex}`).digest("hex");
  return `tsk-${hash.substring(0, 8)}`;
}

export interface SyncOptions {
  playbookStore?: PlaybookStore;
  direction?: "push" | "pull" | "bidirectional";
}

export interface SyncResult {
  todos: HubTodoItem[];
  fileUpdated: boolean;
  activeFilePath: string;
}

export class TodoMarkdownSync {
  public sync(
    filePath: string,
    existingTodos: HubTodoItem[],
    options?: SyncOptions
  ): SyncResult {
    const resolvedPath = path.resolve(filePath);
    const shared = getSharedHub();

    // 1. If file does not exist, initialize it
    if (!fs.existsSync(resolvedPath)) {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const initialLines: string[] = ["# Todos", ""];
      for (const todo of existingTodos) {
        const mark = STATUS_TO_CHECKBOX[todo.status] || " ";
        initialLines.push(`- [${mark}] ${todo.title} ^${todo.blockId}`);
      }
      fs.writeFileSync(resolvedPath, initialLines.join("\n") + "\n", "utf8");
      return {
        todos: [...existingTodos],
        fileUpdated: true,
        activeFilePath: resolvedPath,
      };
    }

    // 2. Read existing markdown content
    let raw = "";
    try {
      raw = fs.readFileSync(resolvedPath, "utf8");
    } catch (err) {
      return {
        todos: [...existingTodos],
        fileUpdated: false,
        activeFilePath: resolvedPath,
      };
    }

    const rawLines = raw.split(/\r?\n/);
    const syncedTodos: HubTodoItem[] = [];
    const seenBlockIds = new Set<string>();
    const seenTodoIds = new Set<string>();
    const updatedLines: string[] = [];
    let fileChanged = false;

    const existingMap = new Map<string, HubTodoItem>();
    for (const t of existingTodos) {
      existingMap.set(t.blockId, t);
      existingMap.set(t.id, t);
    }

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const match = CHECKLIST_LINE_REGEX.exec(line);

      if (match) {
        const prefix = match[1];
        let markChar = match[2];
        const separator = match[3];
        const rawContent = match[4].trim();
        let blockId = match[5];

        if (!blockId) {
          blockId = generateDeterministicBlockId(rawContent, i);
          fileChanged = true;
        }

        const statusFromMd = CHECKBOX_TO_STATUS[markChar] || "ready";
        const existing = existingMap.get(blockId);
        let item: HubTodoItem;

        if (existing) {
          item = { ...existing };
          const expectedMark = STATUS_TO_CHECKBOX[item.status] || " ";

          if (options?.direction === "push") {
            // Memory is authoritative: align Markdown checkbox to memory item status
            if (markChar !== expectedMark) {
              markChar = expectedMark;
              fileChanged = true;
            }
          } else {
            // Bidirectional/Pull: user change in Markdown takes precedence
            if (item.status !== statusFromMd) {
              item.status = statusFromMd;
              item.updatedAt = new Date().toISOString();
            } else if (markChar !== expectedMark) {
              markChar = expectedMark;
              fileChanged = true;
            }
          }

          if (item.title !== rawContent) {
            item.title = rawContent;
            item.rawText = rawContent;
            item.updatedAt = new Date().toISOString();
          }
        } else {
          // New todo created directly in Markdown file
          const id = `todo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (shared?.triageTodoItem) {
            const category = shared.inferCategory ? shared.inferCategory(rawContent) : "general";
            const pb = options?.playbookStore?.getPlaybook(category);
            item = shared.triageTodoItem(id, blockId, rawContent, {
              originChannel: "markdown",
              playbook: pb,
              existingStatus: statusFromMd,
            });
          } else {
            const now = new Date().toISOString();
            item = {
              id,
              blockId,
              title: rawContent,
              rawText: rawContent,
              status: statusFromMd,
              domain: "core",
              privacyTier: "private_cloud",
              category: "general",
              urgencyScore: 0.35,
              ambiguityScore: 0.2,
              clarificationQuestions: [],
              contextNotes: [],
              allowManualCredit: false,
              originChannel: "markdown",
              createdAt: now,
              updatedAt: now,
            };
          }

          if (item.status === "needs_clarification" && markChar === " ") {
            markChar = "?";
            fileChanged = true;
          }
        }

        seenBlockIds.add(blockId);
        seenTodoIds.add(item.id);
        syncedTodos.push(item);

        const newLine = `${prefix}${markChar}${separator}${rawContent} ^${blockId}`;
        if (newLine !== line) {
          fileChanged = true;
        }
        updatedLines.push(newLine);
      } else {
        // Non-checklist line preserved exactly as is
        updatedLines.push(line);
      }
    }

    // 3. Append missing todos from memory that weren't present in the markdown
    for (const todo of existingTodos) {
      if (!seenBlockIds.has(todo.blockId) && !seenTodoIds.has(todo.id)) {
        const mark = STATUS_TO_CHECKBOX[todo.status] || " ";
        updatedLines.push(`- [${mark}] ${todo.title} ^${todo.blockId}`);
        syncedTodos.push(todo);
        seenBlockIds.add(todo.blockId);
        seenTodoIds.add(todo.id);
        fileChanged = true;
      }
    }

    if (fileChanged) {
      fs.writeFileSync(resolvedPath, updatedLines.join("\n"), "utf8");
    }

    return {
      todos: syncedTodos,
      fileUpdated: fileChanged,
      activeFilePath: resolvedPath,
    };
  }
}
