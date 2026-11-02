import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type {
  CategoryPlaybook,
  EpisodicMemoryItem,
  SemanticMemoryItem,
  ProceduralMemoryItem,
  HubTodoItem,
} from "./index";
import { resolvePlatformStateRoot } from "../platformPaths";

const SEED_CATEGORIES: Array<{ category: string; label: string }> = [
  { category: "purchasing", label: "구매 & 쇼핑" },
  { category: "hardware-trade", label: "하드웨어 & 부품 거래" },
  { category: "home-ops", label: "생활 & 홈 관리" },
  { category: "coding", label: "소프트웨어 개발 & 엔지니어링" },
  { category: "research", label: "리서치 & 시장 조사" },
  { category: "general", label: "일반 업무" },
];

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

export class PlaybookStore {
  private readonly filePath: string;
  private playbooks = new Map<string, CategoryPlaybook>();

  public constructor(customPathOrStateRoot?: string) {
    if (customPathOrStateRoot) {
      if (customPathOrStateRoot.endsWith(".json")) {
        this.filePath = path.resolve(customPathOrStateRoot);
      } else {
        this.filePath = path.join(path.resolve(customPathOrStateRoot), "playbooks.json");
      }
    } else {
      this.filePath = path.join(resolvePlatformStateRoot(), "playbooks.json");
    }
    this.load();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private load(): void {
    this.playbooks.clear();

    // Initialize with seeds
    for (const seed of SEED_CATEGORIES) {
      this.playbooks.set(seed.category, {
        category: seed.category,
        label: seed.label,
        episodic: [],
        semantic: [],
        procedural: [],
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const list: CategoryPlaybook[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.category) {
              const existing = this.playbooks.get(item.category);
              this.playbooks.set(item.category, {
                category: item.category,
                label: item.label || existing?.label || item.category,
                episodic: Array.isArray(item.episodic) ? item.episodic : [],
                semantic: Array.isArray(item.semantic) ? item.semantic : [],
                procedural: Array.isArray(item.procedural) ? item.procedural : [],
                updatedAt: item.updatedAt || new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch {
      // Keep defaults if file read fails
    }
  }

  private flush(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.playbooks.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      throw new Error(`Failed to save playbooks to ${this.filePath}: ${err}`);
    }
  }

  public getPlaybooks(): CategoryPlaybook[] {
    return Array.from(this.playbooks.values());
  }

  public getPlaybook(category: string): CategoryPlaybook | undefined {
    return this.playbooks.get(category);
  }

  public ensurePlaybook(category: string, label?: string): CategoryPlaybook {
    let pb = this.playbooks.get(category);
    if (!pb) {
      pb = {
        category,
        label: label || category,
        episodic: [],
        semantic: [],
        procedural: [],
        updatedAt: new Date().toISOString(),
      };
      this.playbooks.set(category, pb);
      this.flush();
    }
    return pb;
  }

  public savePlaybook(playbook: CategoryPlaybook): void {
    this.playbooks.set(playbook.category, {
      ...playbook,
      updatedAt: new Date().toISOString(),
    });
    this.flush();
  }

  public recordEpisodic(category: string, summary: string): EpisodicMemoryItem {
    const pb = this.ensurePlaybook(category);
    const item: EpisodicMemoryItem = {
      id: randomId("epi"),
      summary,
      recordedAt: new Date().toISOString(),
    };
    pb.episodic.unshift(item);
    // Keep most recent 50 episodic items
    if (pb.episodic.length > 50) {
      pb.episodic = pb.episodic.slice(0, 50);
    }
    pb.updatedAt = new Date().toISOString();
    this.flush();
    return item;
  }

  public recordSemantic(category: string, preference: string, rationale: string): SemanticMemoryItem {
    const pb = this.ensurePlaybook(category);
    const item: SemanticMemoryItem = {
      id: randomId("sem"),
      preference,
      rationale,
      recordedAt: new Date().toISOString(),
    };
    pb.semantic.unshift(item);
    pb.updatedAt = new Date().toISOString();
    this.flush();
    return item;
  }

  public recordProcedural(category: string, trigger: string, rule: string): ProceduralMemoryItem {
    const pb = this.ensurePlaybook(category);
    const item: ProceduralMemoryItem = {
      id: randomId("pro"),
      trigger,
      rule,
      recordedAt: new Date().toISOString(),
    };
    pb.procedural.unshift(item);
    pb.updatedAt = new Date().toISOString();
    this.flush();
    return item;
  }

  public extractPlaybookInsightsFromClarification(
    todo: HubTodoItem,
    answerText: string,
    learnedPreference?: string,
    learnedRule?: string
  ): {
    playbook: CategoryPlaybook;
    newSemantic?: SemanticMemoryItem;
    newProcedural?: ProceduralMemoryItem;
  } {
    const category = todo.category || "general";
    let newSemantic: SemanticMemoryItem | undefined;
    let newProcedural: ProceduralMemoryItem | undefined;

    if (learnedPreference?.trim()) {
      newSemantic = this.recordSemantic(
        category,
        learnedPreference.trim(),
        `Learned from clarification on: ${todo.title}`
      );
    }

    if (learnedRule?.trim()) {
      newProcedural = this.recordProcedural(
        category,
        todo.title,
        learnedRule.trim()
      );
    }

    if (!newSemantic && !newProcedural) {
      this.recordEpisodic(category, `Clarification on "${todo.title}": ${answerText}`);
    }

    const playbook = this.ensurePlaybook(category);
    return { playbook, newSemantic, newProcedural };
  }
}
