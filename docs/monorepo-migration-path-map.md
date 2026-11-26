# Integrated Power Monorepo Unification Path Backup Map

**Timestamp:** 2026-11-11
**Purpose:** Record all physical paths, package boundaries, module dependencies, and fallback routing prior to consolidating into a single `packages/` monorepo structure.

---

## 1. Existing Workspace Roots (Before Migration)

| Identifier | Source Path | Description | Git Status / State |
| :--- | :--- | :--- | :--- |
| **Track 1 (IP)** | `D:\Workspace\Integrated POWER\vscode-extension` | Antigravity IDE VSIX Extension (Language Client, Token Scanner, Status Bar, Broker Host) | Active repository root |
| **Track 2 (IPCC Standalone)** | `D:\Workspace\integrated-power-control-center` | Integrated Power Control Center (Standalone Broker daemon, Vite UI, Tauri Desktop App) | Contains latest 6 UI features, static web serving on 37241, ensure-broker scripts |
| **Track 2 (IPCC Internal Mirror)**| `D:\Workspace\Integrated POWER\control-center` | Internal mirror inside Integrated POWER | Older mirror; needs sync with Track 2 standalone |
| **Shared Libraries** | `D:\Workspace\Integrated POWER\shared` | Shared modules: `shared/quota`, `shared/hub`, `shared/telemetry` | Shared across extension and control center |

---

## 2. Target Unified Monorepo Layout (`packages/`)

```
D:\Workspace\Integrated POWER\
├── packages/
│   ├── vscode-extension/          <-- Migrated from vscode-extension/
│   │   ├── package.json
│   │   ├── src/
│   │   ├── webview/
│   │   └── scripts/
│   ├── control-center/            <-- Canonical sync from D:\Workspace\integrated-power-control-center
│   │   ├── package.json
│   │   ├── broker-server.js
│   │   ├── mcp-server.js
│   │   ├── src/
│   │   ├── src-tauri/
│   │   ├── scripts/
│   │   └── dist/
│   └── shared/                    <-- Migrated from shared/
│       ├── quota/
│       ├── hub/
│       └── telemetry/
├── docs/                          <-- Architecture, guides, reuse maps
├── scripts/                       <-- Root orchestrator scripts
├── package.json                   <-- Root monorepo manifest (workspaces: ["packages/*"])
├── pnpm-workspace.yaml            <-- pnpm monorepo configuration
└── AGENTS.md                      <-- Root agent contract
```

---

## 3. Path Mapping & Fallback Matrix

| Original Path | Target Unified Path | Compatibility / Fallback Mechanism |
| :--- | :--- | :--- |
| `D:\Workspace\Integrated POWER\vscode-extension` | `D:\Workspace\Integrated POWER\packages\vscode-extension` | Kept via symlink/junction or legacy path resolution |
| `D:\Workspace\integrated-power-control-center` | `D:\Workspace\Integrated POWER\packages\control-center` | Standalone repo retained as untouched backup; forwarder script in ensure-broker.cmd |
| `D:\Workspace\Integrated POWER\control-center` | `D:\Workspace\Integrated POWER\packages\control-center` | Replaced/updated by canonical package |
| `D:\Workspace\Integrated POWER\shared` | `D:\Workspace\Integrated POWER\packages\shared` (and alias) | Path candidates in `shared-quota-source.js` & `shared-hub-source.js` check both |

---

## 4. External Callers & Hook Inventory

1. **`C:\Users\jsp0\.gemini\config\plugins\ip-orchestrator-plugin\hooks.json`**:
   - Original: `cmd /c "d:\Workspace\integrated-power-control-center\scripts\ensure-broker.cmd"`
   - Target: `cmd /c "d:\Workspace\Integrated POWER\packages\control-center\scripts\ensure-broker.cmd"`
   - Fallback: `d:\Workspace\integrated-power-control-center\scripts\ensure-broker.cmd` forwards to target.

2. **`D:\Workspace\Integrated POWER\.agents\hooks.json`**:
   - Original: `cmd /c "d:\Workspace\integrated-power-control-center\scripts\ensure-broker.cmd"`
   - Target: `cmd /c "d:\Workspace\Integrated POWER\packages\control-center\scripts\ensure-broker.cmd"`

3. **Resolver Candidates (`workspace-paths.js`)**:
   - Candidates list updated to check `packages/vscode-extension` in addition to `../vscode-extension`.

4. **Static UI Directory Resolver (`vscode-extension/src/broker/server.ts`)**:
   - Candidates list checks `packages/control-center/dist` in addition to `control-center/dist`.

---

## 5. Recovery Plan
If any breakage occurs during or after migration:
1. All files in `D:\Workspace\integrated-power-control-center` remain 100% intact and untouched.
2. Backup copy of `control-center` inside `Integrated POWER` preserved in `control-center.bak-pre-monorepo`.
3. Root `package.json` can be reverted without affecting individual package directories.
