// vscode-extension/src/broker/gdriveStorage.ts
// Integrated Power: Google Drive Ingestion (Option B) & Artifact Offloader (Option C)

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { CreateTaskInput, TaskEnvelope } from './protocol';

export interface DriveStorageConfig {
  configDir?: string;
  oauthKeyPath?: string;
  credentialsPath?: string;
}

export interface DriveTokenData {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface StorageQuotaInfo {
  limitBytes: number;
  usageBytes: number;
  limitGb: number;
  usageGb: number;
  percentUsed: number;
}

export interface OffloadResult {
  fileId: string;
  fileName: string;
  remoteFolderId: string;
  sizeBytes: number;
  webViewLink?: string;
  uploadedAt: string;
}

export interface IngestedTaskResult {
  fileId: string;
  fileName: string;
  taskTitle: string;
  taskGoal: string;
  idempotencyKey: string;
  task?: TaskEnvelope;
}

/**
 * 1. Google Drive Token Manager with automatic OAuth 2.0 refresh
 */
export class GoogleDriveAuth {
  private readonly oauthKeyPath: string;
  private readonly credentialsPath: string;
  private cachedTokens: DriveTokenData | null = null;

  constructor(config?: DriveStorageConfig) {
    const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\jsp0';
    const baseDir = config?.configDir || path.join(homeDir, '.config', 'google-drive-mcp');
    this.oauthKeyPath = config?.oauthKeyPath || path.join(baseDir, 'gcp-oauth.keys.json');
    this.credentialsPath = config?.credentialsPath || path.join(baseDir, '.gdrive-server-credentials.json');
  }

  public isConfigured(): boolean {
    return fs.existsSync(this.oauthKeyPath) && fs.existsSync(this.credentialsPath);
  }

  public async getValidAccessToken(): Promise<string> {
    if (!this.cachedTokens) {
      if (!fs.existsSync(this.credentialsPath)) {
        throw new Error(`Google Drive credentials not found at ${this.credentialsPath}`);
      }
      this.cachedTokens = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'));
    }

    const now = Date.now();
    const expiry = this.cachedTokens?.expiry_date || 0;

    // Refresh token if expired or about to expire in 60s
    if (this.cachedTokens && (!this.cachedTokens.access_token || (expiry && expiry - now < 60000))) {
      await this.refreshAccessToken();
    }

    return this.cachedTokens!.access_token;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!fs.existsSync(this.oauthKeyPath)) {
      throw new Error(`OAuth key file missing at ${this.oauthKeyPath}`);
    }
    const keyData = JSON.parse(fs.readFileSync(this.oauthKeyPath, 'utf-8'));
    const keys = keyData.installed || keyData.web;
    const refreshToken = this.cachedTokens?.refresh_token;

    if (!refreshToken) {
      throw new Error('No refresh token available to refresh access token');
    }

    const postData = new URLSearchParams({
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const response = await this.httpPost('https://oauth2.googleapis.com/token', postData, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(postData)),
    });

    const refreshed = JSON.parse(response);
    this.cachedTokens = {
      ...this.cachedTokens!,
      access_token: refreshed.access_token,
      expiry_date: Date.now() + (refreshed.expires_in || 3600) * 1000,
    };

    fs.writeFileSync(this.credentialsPath, JSON.stringify(this.cachedTokens, null, 2), 'utf-8');
  }

  private httpPost(urlStr: string, body: string, headers: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP POST ${urlStr} failed (${res.statusCode}): ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

/**
 * 2. Google Drive Low-Level API Client
 */
export class GoogleDriveClient {
  constructor(private readonly auth: GoogleDriveAuth = new GoogleDriveAuth()) {}

  public async getStorageQuota(): Promise<StorageQuotaInfo> {
    const data = await this.apiGet('/drive/v3/about?fields=storageQuota');
    const quota = data.storageQuota || {};
    const limitBytes = Number(quota.limit) || 0;
    const usageBytes = Number(quota.usage) || 0;
    const limitGb = limitBytes / 1024 ** 3;
    const usageGb = usageBytes / 1024 ** 3;
    const percentUsed = limitBytes > 0 ? (usageBytes / limitBytes) * 100 : 0;

    return { limitBytes, usageBytes, limitGb, usageGb, percentUsed };
  }

  public async findFolder(folderName: string, parentId?: string): Promise<string | null> {
    let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }
    const res = await this.apiGet(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    if (res.files && res.files.length > 0) {
      return res.files[0].id;
    }
    return null;
  }

  public async createFolder(folderName: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    const res = await this.apiPostJson('/drive/v3/files?fields=id,name', metadata);
    return res.id;
  }

  public async ensureFolder(folderName: string, parentId?: string): Promise<string> {
    const existing = await this.findFolder(folderName, parentId);
    if (existing) return existing;
    return this.createFolder(folderName, parentId);
  }

  public async ensureIntegratedPowerStructure(): Promise<{
    rootId: string;
    inboxId: string;
    inboxProcessedId: string;
    artifactsId: string;
  }> {
    const rootId = await this.ensureFolder('IntegratedPower');
    const inboxId = await this.ensureFolder('Inbox', rootId);
    const inboxProcessedId = await this.ensureFolder('processed', inboxId);
    const artifactsId = await this.ensureFolder('Artifacts', rootId);

    return { rootId, inboxId, inboxProcessedId, artifactsId };
  }

  public async listFilesInFolder(folderId: string): Promise<DriveFileItem[]> {
    const q = `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const res = await this.apiGet(
      `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`
    );
    return res.files || [];
  }

  public async downloadFileText(file: DriveFileItem): Promise<string> {
    // If it's a native Google Doc, export it as plain text
    if (file.mimeType === 'application/vnd.google-apps.document') {
      return this.apiGetRaw(`/drive/v3/files/${file.id}/export?mimeType=text/plain`);
    }
    // Otherwise download raw media
    return this.apiGetRaw(`/drive/v3/files/${file.id}?alt=media`);
  }

  public async moveFile(fileId: string, removeParentId: string, addParentId: string): Promise<void> {
    const path = `/drive/v3/files/${fileId}?removeParents=${removeParentId}&addParents=${addParentId}&fields=id,parents`;
    await this.apiPatchJson(path, {});
  }

  public async uploadFile(
    parentId: string,
    fileName: string,
    mimeType: string,
    content: Buffer | string
  ): Promise<DriveFileItem> {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const metadata = {
      name: fileName,
      parents: [parentId],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody = Buffer.concat([
      Buffer.from(
        delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          `Content-Type: ${mimeType}\r\n\r\n`
      ),
      buffer,
      Buffer.from(closeDelimiter),
    ]);

    const token = await this.auth.getValidAccessToken();
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'www.googleapis.com',
          path: '/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Content-Length': String(multipartBody.length),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Upload failed (${res.statusCode}): ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(multipartBody);
      req.end();
    });
  }

  private async apiGet(apiPath: string): Promise<any> {
    const token = await this.auth.getValidAccessToken();
    return new Promise((resolve, reject) => {
      https
        .get(
          {
            hostname: 'www.googleapis.com',
            path: apiPath,
            headers: { Authorization: `Bearer ${token}` },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error(`API GET ${apiPath} failed (${res.statusCode}): ${data}`));
              }
            });
          }
        )
        .on('error', reject);
    });
  }

  private async apiGetRaw(apiPath: string): Promise<string> {
    const token = await this.auth.getValidAccessToken();
    return new Promise((resolve, reject) => {
      https
        .get(
          {
            hostname: 'www.googleapis.com',
            path: apiPath,
            headers: { Authorization: `Bearer ${token}` },
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`API GET Raw ${apiPath} failed (${res.statusCode}): ${data}`));
              }
            });
          }
        )
        .on('error', reject);
    });
  }

  private async apiPostJson(apiPath: string, payload: unknown): Promise<any> {
    const token = await this.auth.getValidAccessToken();
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'www.googleapis.com',
          path: apiPath,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`API POST ${apiPath} failed (${res.statusCode}): ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async apiPatchJson(apiPath: string, payload: unknown): Promise<any> {
    const token = await this.auth.getValidAccessToken();
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'www.googleapis.com',
          path: apiPath,
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data ? JSON.parse(data) : {});
            } else {
              reject(new Error(`API PATCH ${apiPath} failed (${res.statusCode}): ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

/**
 * 3. Option B: Google Drive Inbox Ingestion Service
 * Scans IntegratedPower/Inbox for mobile/web Gemini notes and converts them into Broker Tasks.
 */
export class DriveIngestionService {
  constructor(
    private readonly client: GoogleDriveClient = new GoogleDriveClient(),
    private readonly taskCreator?: (input: CreateTaskInput) => Promise<TaskEnvelope>
  ) {}

  public async pollAndIngest(): Promise<IngestedTaskResult[]> {
    const structure = await this.client.ensureIntegratedPowerStructure();
    const files = await this.client.listFilesInFolder(structure.inboxId);
    const results: IngestedTaskResult[] = [];

    for (const file of files) {
      // Ignore subfolders if any
      if (file.mimeType === 'application/vnd.google-apps.folder') continue;

      const rawText = await this.client.downloadFileText(file);
      const idempotencyKey = `gdrive_inbox_${file.id}`;
      const title = `[Mobile/Drive Ingest] ${file.name.replace(/\.[^/.]+$/, '')}`;
      const goal = rawText.trim() || `Process ingested document from Google Drive: ${file.name}`;

      const taskInput: CreateTaskInput = {
        title,
        goal,
        originProvider: 'google.antigravity.app',
        privacy: 'private',
        idempotencyKey,
      };

      let createdTask: TaskEnvelope | undefined;
      if (this.taskCreator) {
        createdTask = await this.taskCreator(taskInput);
      }

      // Move processed file to IntegratedPower/Inbox/processed
      await this.client.moveFile(file.id, structure.inboxId, structure.inboxProcessedId);

      results.push({
        fileId: file.id,
        fileName: file.name,
        taskTitle: title,
        taskGoal: goal,
        idempotencyKey,
        task: createdTask,
      });
    }

    return results;
  }
}

/**
 * 4. Option C: Google Drive Artifact Offloader
 * Offloads local build outputs (.vsix), test logs, or recordings to 5TB Google Drive.
 */
export class DriveArtifactOffloader {
  constructor(private readonly client: GoogleDriveClient = new GoogleDriveClient()) {}

  public async offloadArtifact(
    taskId: string,
    localFilePath: string,
    remoteFileName?: string
  ): Promise<OffloadResult> {
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local artifact file does not exist: ${localFilePath}`);
    }

    const structure = await this.client.ensureIntegratedPowerStructure();
    // Create or find task-specific folder under Artifacts
    const taskFolderId = await this.client.ensureFolder(taskId, structure.artifactsId);

    const stats = fs.statSync(localFilePath);
    const fileName = remoteFileName || path.basename(localFilePath);
    const mimeType = this.resolveMimeType(fileName);
    const content = fs.readFileSync(localFilePath);

    const uploaded = await this.client.uploadFile(taskFolderId, fileName, mimeType, content);

    return {
      fileId: uploaded.id,
      fileName: uploaded.name,
      remoteFolderId: taskFolderId,
      sizeBytes: stats.size,
      webViewLink: uploaded.webViewLink,
      uploadedAt: new Date().toISOString(),
    };
  }

  private resolveMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.json':
        return 'application/json';
      case '.txt':
      case '.log':
      case '.md':
        return 'text/plain';
      case '.webp':
        return 'image/webp';
      case '.png':
        return 'image/png';
      case '.mp4':
        return 'video/mp4';
      case '.vsix':
      case '.zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
  }
}

export interface DistillTaskInput {
  task: TaskEnvelope;
  summary: string;
  tags?: string[];
  keyDecisions?: string[];
  offloadedArtifacts?: OffloadResult[];
}

export interface DistilledKnowledgeMarkdown {
  fileName: string;
  markdown: string;
  vaultPath?: string;
  hasArtifactPointers: boolean;
  exported: boolean;
}

/**
 * 4. Drive Knowledge Distillation Bridge
 * Bridges Google Drive 5TB heavy binary artifacts with GitHub/Obsidian curated text knowledge (eggr-knowledge).
 * Enforces:
 *   - Obsidian Vault: Curated text, summaries, decisions, and markdown backlink graph (lightweight Git).
 *   - Google Drive: Heavy binary assets (VSIX, WebP, MP4, raw logs) linked via permanent webViewLink.
 */
export class DriveKnowledgeDistillationBridge {
  constructor(private readonly defaultVaultInboxPath: string = process.platform === 'win32' ? 'D:\\obsidian\\00 Inbox' : path.join(process.env.HOME || '', 'obsidian', '00 Inbox')) {}

  public distill(input: DistillTaskInput, targetVaultInbox?: string): DistilledKnowledgeMarkdown {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const sanitizedTitle = (input.task.title || input.task.id || 'Task')
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 50);

    const fileName = `${dateStr}_${sanitizedTitle}.md`;
    const tags = Array.from(new Set(['#IntegratedPower', '#Knowledge', ...(input.tags || [])]));

    const lines: string[] = [];
    lines.push('---');
    lines.push(`id: "${input.task.id}"`);
    lines.push(`title: "${input.task.title.replace(/"/g, '\\"')}"`);
    lines.push(`date: ${dateStr}`);
    lines.push(`tags: [${tags.map((t) => `"${t.replace(/^#/, '')}"`).join(', ')}]`);
    lines.push(`status: "${input.task.status || 'completed'}"`);
    lines.push(`storageTier: "Google Drive 5TB (Tier 2 Offload)"`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${input.task.title}`);
    lines.push('');
    lines.push(`> **태스크 ID**: \`${input.task.id}\` | **완료일시**: ${now.toISOString()}`);
    lines.push('');
    lines.push('## 1. 개요 및 목표');
    lines.push(input.task.goal || input.summary || '목표 설명 없음.');
    lines.push('');

    if (input.keyDecisions && input.keyDecisions.length > 0) {
      lines.push('## 2. 주요 아키텍처 결정 사항 (Key Decisions)');
      for (const d of input.keyDecisions) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }

    lines.push('## 3. 구현 및 해결 내용 (Summary)');
    lines.push(input.summary);
    lines.push('');

    const artifacts = input.offloadedArtifacts || [];
    const hasArtifactPointers = artifacts.length > 0;
    if (hasArtifactPointers) {
      lines.push('## 4. 대용량 산출물 (Google Drive 5TB 클라우드 보관)');
      lines.push('> *Git 저장소 용량 보존을 위해 무거운 바이너리는 Google Drive에 보관되며, 아래 영구 링크로 즉시 열람/다운로드할 수 있습니다.*');
      lines.push('');
      for (const a of artifacts) {
        const sizeMb = (a.sizeBytes / (1024 * 1024)).toFixed(2);
        const link = a.webViewLink || '#';
        lines.push(`- **[${a.fileName}](${link})** (${sizeMb} MB) — \`fileId: ${a.fileId}\``);
      }
      lines.push('');
    }

    const markdown = lines.join('\n');
    const vaultInbox = targetVaultInbox || this.defaultVaultInboxPath;
    let exported = false;
    let fullVaultPath: string | undefined;

    if (fs.existsSync(vaultInbox)) {
      fullVaultPath = path.join(vaultInbox, fileName);
      try {
        fs.writeFileSync(fullVaultPath, markdown, 'utf-8');
        exported = true;
      } catch {
        exported = false;
      }
    }

    return {
      fileName,
      markdown,
      vaultPath: fullVaultPath,
      hasArtifactPointers,
      exported,
    };
  }
}

