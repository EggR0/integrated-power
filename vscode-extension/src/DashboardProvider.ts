import * as crypto from "crypto";
import * as vscode from "vscode";
import { DashboardController } from "./DashboardController";
import { DashboardOutboundMessage } from "./types";

export class DashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly controller: DashboardController;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.controller = new DashboardController(this.context, (message) => this.postMessage(message));
    this.disposables.push(this.controller);
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "webview")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.controller.handleMessage(message);
      },
      undefined,
      this.disposables,
    );

    webviewView.onDidChangeVisibility(
      () => {
        if (webviewView.visible) {
          void this.controller.refresh(true);
        }
      },
      undefined,
      this.disposables,
    );

    this.controller.publishState();
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public refresh(): Promise<void> {
    return this.controller.refresh();
  }

  public openRunsFile(): Promise<void> {
    return this.controller.openRunsFile();
  }

  private postMessage(message: DashboardOutboundMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "styles.css"),
    );
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "webview", "mermaid.min.js"),
    );

    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agent Runs</title>
</head>
<body>
  <main id="app"></main>
  <script nonce="${nonce}" src="${mermaidUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private createNonce(): string {
    return crypto.randomBytes(16).toString("hex");
  }
}
