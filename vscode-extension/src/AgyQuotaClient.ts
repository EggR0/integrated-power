import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as cp from 'child_process';
import { createHash } from 'crypto';
import type { AccountQuotaInfo, GcpProjectQuotaInfo, QuotaPoolStatus } from './types';

const API_BASE = 'https://daily-cloudcode-pa.googleapis.com/v1internal';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

export interface QuotaToken {
  access_token: string;
  expiry: number;
}

export interface QuotaResult {
  quota: any;
  token: QuotaToken;
  account: string;
  fetchedAt: number;
  multiAccountResult?: MultiAccountQuotaResult;
}

export interface MultiAccountQuotaResult {
  primaryAccount: string;
  accounts: Record<string, AccountQuotaInfo>;
  gcpProjects: Record<string, GcpProjectQuotaInfo>;
  quota: any;
  token: QuotaToken;
  account: string;
  fetchedAt: number;
}

export class AgyNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgyNotInstalledError';
  }
}

export class AgyNotAuthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgyNotAuthenticatedError';
  }
}

export class AgyQuotaClient {
  private static inMemoryCachedTokens: Map<string, { token: QuotaToken; credentialKey: string }> = new Map();
  private extensionPath: string;

  constructor(extensionPath: string = __dirname) {
    this.extensionPath = extensionPath;
  }

  private execFileAsync(file: string, args: string[], options: cp.ExecFileOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile(file, args, options, (error, stdout, stderr) => {
        if (error) {
          (error as any).stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout.toString());
      });
    });
  }

  private findAgy(): string {
    const candidates = [
      process.env.AGY_PATH,
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.gemini', 'bin', 'agy.exe'),
    ].filter(Boolean) as string[];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new AgyNotInstalledError('agy.exe was not found. Install Antigravity CLI first.');
    }
    return found;
  }

  public async readCredential(target: string = 'gemini:antigravity'): Promise<any> {
    const script = path.join(this.extensionPath, 'scripts', 'read-agy-credential.ps1');
    const stdout = await this.execFileAsync(
      'cmd.exe',
      ['/c', 'chcp', '65001', '>nul', '&&', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Target', target],
      { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 15000 }
    );
    const credential = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!credential.token) {
      throw new AgyNotAuthenticatedError('The agy credential does not contain a token. Sign in to agy again.');
    }
    return credential;
  }

  public async readAllCredentials(): Promise<{ accounts: Record<string, any>; gcpProjects: Record<string, any>; activeIdeAccount?: string }> {
    const script = path.join(this.extensionPath, 'scripts', 'read-all-credentials.ps1');
    try {
      const stdout = await this.execFileAsync(
        'cmd.exe',
        ['/c', 'chcp', '65001', '>nul', '&&', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 15000 }
      );
      return JSON.parse(stdout.replace(/^\uFEFF/, ''));
    } catch {
      try {
        const cred = await this.readCredential('gemini:antigravity');
        const email = cred.id_token_email || 'default';
        return {
          accounts: { [email]: cred },
          gcpProjects: {},
          activeIdeAccount: email,
        };
      } catch {
        return { accounts: {}, gcpProjects: {} };
      }
    }
  }

  private expiryEpoch(value: any): number {
    if (typeof value === 'number') {
      return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    }
    if (typeof value === 'string') {
      if (/^\d+$/.test(value)) return this.expiryEpoch(Number(value));
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    }
    return 0;
  }

  public tokenIsValid(token: any): boolean {
    return Boolean(token && token.access_token && this.expiryEpoch(token.expiry) > Math.floor(Date.now() / 1000) + 60);
  }

  private requestJson(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<any> {
    const { method = 'GET', headers = {}, body } = options;
    return new Promise((resolve, reject) => {
      const request = https.request(url, { method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            reject(new Error(`The server returned invalid JSON (HTTP ${response.statusCode}).`));
            return;
          }
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            const message = data.error && data.error.message ? data.error.message : text;
            reject(new Error(`Request failed (HTTP ${response.statusCode}): ${message}`));
            return;
          }
          resolve(data);
        });
      });
      request.setTimeout(15000, () => request.destroy(new Error('The quota request timed out.')));
      request.on('error', reject);
      if (body) request.write(body);
      request.end();
    });
  }

  private clientSecretsFromBinary(agyPath: string): string[] {
    const binary = fs.readFileSync(agyPath).toString('latin1');
    return [...new Set(binary.match(/GOCSPX-[A-Za-z0-9_-]{28}/g) || [])];
  }

  private async refreshAccessToken(refreshToken: string, agyPath: string): Promise<QuotaToken> {
    if (!refreshToken) throw new AgyNotAuthenticatedError('The agy credential has no refresh token. Sign in to agy again.');
    const secrets = this.clientSecretsFromBinary(agyPath);
    if (!secrets.length) throw new AgyNotAuthenticatedError('OAuth client information could not be read from the installed agy binary. Sign in to agy again.');

    let lastError: any;
    for (const secret of secrets) {
      const form = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: secret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString();
      try {
        const response = await this.requestJson(OAUTH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': String(Buffer.byteLength(form)),
          },
          body: form,
        });
        if (response.access_token) {
          return {
            access_token: response.access_token,
            expiry: Math.floor(Date.now() / 1000) + (response.expires_in || 3600),
          };
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new AgyNotAuthenticatedError(lastError ? (lastError instanceof Error ? lastError.message : String(lastError.message || lastError)) : 'Failed to refresh the agy OAuth token. Sign in to agy again.');
  }

  private async agyVersion(agyPath: string): Promise<string> {
    try {
      const output = await this.execFileAsync(agyPath, ['--version'], {
        windowsHide: true,
        timeout: 10000,
      });
      const match = output.match(/\d+\.\d+\.\d+/);
      return match ? match[0] : '1.4.12';
    } catch {
      return '1.4.12';
    }
  }

  public async fetchMultiAccountQuota(): Promise<MultiAccountQuotaResult> {
    const agyPath = this.findAgy();
    const version = await this.agyVersion(agyPath);
    const userAgent = `antigravity/cli/${version} windows/amd64`;

    const allCreds = await this.readAllCredentials();
    const accountsMap: Record<string, AccountQuotaInfo> = {};
    const gcpProjectsMap: Record<string, GcpProjectQuotaInfo> = {};

    let primaryAccount = allCreds.activeIdeAccount || '';
    let primaryQuotaResult: { quota: any; token: QuotaToken; account: string } | undefined;

    // 1. Process each discovered user account in parallel
    await Promise.all(
      Object.entries(allCreds.accounts).map(async ([email, credData]) => {
        const isIdeActive = email === allCreds.activeIdeAccount;
        let token: QuotaToken | undefined;

        try {
          if (credData.token) {
            const rawToken = credData.token;
            const identity = String(rawToken.refresh_token || rawToken.access_token || '');
            const credKey = createHash('sha256').update(identity).digest('hex');
            const cached = AgyQuotaClient.inMemoryCachedTokens.get(email);
            if (cached && cached.credentialKey === credKey && this.tokenIsValid(cached.token)) {
              token = cached.token;
            }
            if (!token) {
              if (this.tokenIsValid(rawToken)) {
                token = {
                  access_token: rawToken.access_token,
                  expiry: this.expiryEpoch(rawToken.expiry),
                };
              } else if (rawToken.refresh_token) {
                token = await this.refreshAccessToken(rawToken.refresh_token, agyPath);
              }
            }
            if (token) {
              AgyQuotaClient.inMemoryCachedTokens.set(email, { token, credentialKey: credKey });
            }
          }

          if (!token) {
            accountsMap[email] = {
              email,
              isIdeActive,
              source: credData.source,
              error: isIdeActive ? 'IDE 활성 계정의 토큰이 덮어써졌습니다. 재로그인 필요.' : '유효한 인증 토큰 없음',
              fetchedAt: Date.now(),
            };
            return;
          }

          const headers = {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': userAgent,
          };

          const accountRes = await this.requestJson(`${API_BASE}:loadCodeAssist`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
          });

          if (!accountRes.cloudaicompanionProject) {
            throw new Error('Cloud Code did not return a quota project.');
          }

          const quotaRes = await this.requestJson(`${API_BASE}:retrieveUserQuotaSummary`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ project: accountRes.cloudaicompanionProject }),
          });

          if (!Array.isArray(quotaRes.groups)) {
            throw new Error('The quota response does not contain groups.');
          }

          // Extract bucket percentages
          let gemini5h: number | undefined;
          let gemini5hReset: string | undefined;
          let geminiWeekly: number | undefined;
          let geminiWeeklyReset: string | undefined;
          let argon5h: number | undefined;
          let argon5hReset: string | undefined;
          let argonWeekly: number | undefined;
          let argonWeeklyReset: string | undefined;
          let opus5h: number | undefined;
          let opus5hReset: string | undefined;
          let opusWeekly: number | undefined;
          let opusWeeklyReset: string | undefined;

          for (const group of quotaRes.groups) {
            const label = group.displayName || '';
            const isArgon = label.includes('Argon');
            const isGemini = !isArgon && label.includes('Gemini');
            const isClaude = label.includes('Claude') || label.includes('Opus');

            for (const bucket of group.buckets || []) {
              const pct = typeof bucket.remainingFraction === 'number' && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1
                ? bucket.remainingFraction * 100
                : undefined;
              if (bucket.window === '5h') {
                if (isArgon && argon5h === undefined) { argon5h = pct; argon5hReset = bucket.resetTime; }
                else if (isGemini && gemini5h === undefined) { gemini5h = pct; gemini5hReset = bucket.resetTime; }
                else if (isClaude && opus5h === undefined) { opus5h = pct; opus5hReset = bucket.resetTime; }
              } else if (bucket.window === 'weekly' || bucket.window === '7d') {
                if (isArgon && argonWeekly === undefined) { argonWeekly = pct; argonWeeklyReset = bucket.resetTime; }
                else if (isGemini && geminiWeekly === undefined) { geminiWeekly = pct; geminiWeeklyReset = bucket.resetTime; }
                else if (isClaude && opusWeekly === undefined) { opusWeekly = pct; opusWeeklyReset = bucket.resetTime; }
              }
            }
          }

          const tierName = accountRes.paidTier?.name || accountRes.currentTier?.name || 'Standard';
          accountsMap[email] = {
            email,
            isIdeActive,
            tierName,
            source: credData.source,
            antigravityPercentage: gemini5h,
            antigravityResetTime: gemini5hReset,
            antigravityWeeklyPercentage: geminiWeekly,
            antigravityWeeklyResetTime: geminiWeeklyReset,
            argonPercentage: argon5h,
            argonResetTime: argon5hReset,
            argonWeeklyPercentage: argonWeekly,
            argonWeeklyResetTime: argonWeeklyReset,
            opusPercentage: opus5h,
            opusResetTime: opus5hReset,
            opusWeeklyPercentage: opusWeekly,
            opusWeeklyResetTime: opusWeeklyReset,
            fetchedAt: Date.now(),
          };

          if (!primaryQuotaResult || isIdeActive) {
            primaryAccount = email;
            primaryQuotaResult = {
              quota: quotaRes,
              token,
              account: tierName,
            };
          }
        } catch (err: any) {
          accountsMap[email] = {
            email,
            isIdeActive,
            source: credData.source,
            error: err instanceof Error ? err.message : String(err),
            fetchedAt: Date.now(),
          };
        }
      })
    );

    // 2. Process agya / GCP Projects (Vertex AI via ADC) in parallel
    await Promise.all(
      Object.entries(allCreds.gcpProjects).map(async ([projId, projData]) => {
        try {
          if (projData.client_id && projData.refresh_token) {
            const form = new URLSearchParams({
              client_id: projData.client_id,
              client_secret: projData.client_secret || '',
              refresh_token: projData.refresh_token,
              grant_type: 'refresh_token',
            }).toString();

            const tokenRes = await this.requestJson(OAUTH_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': String(Buffer.byteLength(form)),
              },
              body: form,
            });

            if (tokenRes.access_token) {
              const su = await this.requestJson(`https://serviceusage.googleapis.com/v1/projects/${projId}/services/aiplatform.googleapis.com`, {
                headers: {
                  Authorization: `Bearer ${tokenRes.access_token}`,
                  'x-goog-user-project': projId,
                  Accept: 'application/json',
                },
              });

              gcpProjectsMap[projId] = {
                projectId: projId,
                label: projData.label || 'agya (Vertex AI)',
                vertexAiStatus: su.state === 'ENABLED' ? 'enabled' : 'disabled',
                models: projData.models || ['gemini-4-argon-high', 'gemini-2.0-flash', 'gemini-1.5-pro'],
                authType: 'adc',
                accountEmail: allCreds.activeIdeAccount || 'ADC User',
                fetchedAt: Date.now(),
              };
            }
          }
        } catch (err: any) {
          gcpProjectsMap[projId] = {
            projectId: projId,
            label: projData.label || 'agya (Vertex AI)',
            vertexAiStatus: 'unknown',
            error: err instanceof Error ? err.message : String(err),
            fetchedAt: Date.now(),
          };
        }
      })
    );

    if (!primaryQuotaResult) {
      // If none succeeded, try single fallback
      const fallbackResult = await this.fetchSingleFallback();
      return {
        primaryAccount: primaryAccount || 'default',
        accounts: accountsMap,
        gcpProjects: gcpProjectsMap,
        quota: fallbackResult.quota,
        token: fallbackResult.token,
        account: fallbackResult.account,
        fetchedAt: fallbackResult.fetchedAt,
      };
    }

    return {
      primaryAccount,
      accounts: accountsMap,
      gcpProjects: gcpProjectsMap,
      quota: primaryQuotaResult.quota,
      token: primaryQuotaResult.token,
      account: primaryQuotaResult.account,
      fetchedAt: Date.now(),
    };
  }

  private async fetchSingleFallback(): Promise<QuotaResult> {
    const agyPath = this.findAgy();
    const credential = await this.readCredential('gemini:antigravity');
    const identityMaterial = String(credential.token.refresh_token || credential.token.access_token || '');
    if (!identityMaterial) throw new AgyNotAuthenticatedError('The agy credential has no account token. Sign in to agy again.');
    const credentialKey = createHash('sha256').update(identityMaterial).digest('hex');
    let token: QuotaToken | undefined;
    if (this.tokenIsValid(credential.token)) token = credential.token;
    else token = await this.refreshAccessToken(credential.token.refresh_token, agyPath);
    if (!token) throw new AgyNotAuthenticatedError('The agy credential could not provide a valid account token. Sign in to agy again.');

    const version = await this.agyVersion(agyPath);
    const userAgent = `antigravity/cli/${version} windows/amd64`;
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': userAgent,
    };

    const account = await this.requestJson(`${API_BASE}:loadCodeAssist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });
    if (!account.cloudaicompanionProject) {
      throw new Error('Cloud Code did not return a quota project.');
    }

    const quota = await this.requestJson(`${API_BASE}:retrieveUserQuotaSummary`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ project: account.cloudaicompanionProject }),
    });

    return {
      quota,
      token,
      account: account.paidTier?.name || account.currentTier?.name || '',
      fetchedAt: Date.now(),
    };
  }

  public async fetchQuota(cachedToken?: any): Promise<QuotaResult> {
    void cachedToken;
    try {
      const multi = await this.fetchMultiAccountQuota();
      return {
        quota: multi.quota,
        token: multi.token,
        account: multi.account,
        fetchedAt: multi.fetchedAt,
        multiAccountResult: multi,
      };
    } catch {
      return this.fetchSingleFallback();
    }
  }
}
