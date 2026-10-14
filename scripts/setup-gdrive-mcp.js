// scripts/setup-gdrive-mcp.js
// Integrated Power: Google Drive MCP Helper & Self-Contained Authenticator

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\jsp0';
const CONFIG_DIR = path.join(HOME_DIR, '.config', 'google-drive-mcp');
const OAUTH_KEY_PATH = process.env.GDRIVE_OAUTH_PATH || path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = process.env.GDRIVE_CREDENTIALS_PATH || path.join(CONFIG_DIR, '.gdrive-server-credentials.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function checkStatus() {
  ensureConfigDir();
  const hasKey = fs.existsSync(OAUTH_KEY_PATH);
  const hasCreds = fs.existsSync(CREDENTIALS_PATH);

  console.log('=== Google Drive MCP Status ===');
  console.log(`Config Directory : ${CONFIG_DIR}`);
  console.log(`OAuth Key File   : ${OAUTH_KEY_PATH} [${hasKey ? 'OK' : 'MISSING'}]`);
  console.log(`User Credentials : ${CREDENTIALS_PATH} [${hasCreds ? 'AUTHENTICATED' : 'NOT AUTHENTICATED'}]`);

  if (!hasKey) {
    console.log('\n[Action Required]');
    console.log('1. Go to Google Cloud Console (https://console.cloud.google.com/)');
    console.log('2. Enable Google Drive API and create OAuth 2.0 Client ID (Desktop app).');
    console.log(`3. Download client secret JSON and save it as:`);
    console.log(`   ${OAUTH_KEY_PATH}`);
  } else if (!hasCreds) {
    console.log('\n[Action Required]');
    console.log('Run authentication with: node scripts/setup-gdrive-mcp.js --auth');
  } else {
    console.log('\nGoogle Drive MCP is fully configured and ready for MCP clients.');
  }

  return { hasKey, hasCreds };
}

async function runSelfContainedAuth() {
  ensureConfigDir();
  if (!fs.existsSync(OAUTH_KEY_PATH)) {
    console.error(`\nError: OAuth key file not found at ${OAUTH_KEY_PATH}`);
    process.exit(1);
  }

  const keyData = JSON.parse(fs.readFileSync(OAUTH_KEY_PATH, 'utf-8'));
  const keys = keyData.installed || keyData.web;
  if (!keys || !keys.client_id || !keys.client_secret) {
    console.error('Invalid OAuth key format in gcp-oauth.keys.json');
    process.exit(1);
  }

  const server = http.createServer();
  
  // Listen on ephemeral or port 0
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const redirectUri = `http://localhost:${port}`;
    const scope = encodeURIComponent('https://www.googleapis.com/auth/drive');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${keys.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;

    console.log('\n======================================================');
    console.log('  Google Drive OAuth 2.0 Authentication');
    console.log('======================================================');
    console.log('\nPlease open the following authorization URL in your browser:');
    console.log(`\n${authUrl}\n`);
    console.log('Waiting for authorization callback on localhost...');

    // Attempt to open browser automatically
    const startCmd = process.platform === 'win32' ? `start "" "${authUrl}"` : `open "${authUrl}"`;
    exec(startCmd, () => {});
  });

  server.on('request', async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://localhost:${server.address().port}`);
      const code = parsedUrl.searchParams.get('code');
      const error = parsedUrl.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>Authorization Error: ${error}</h2><p>Please close this tab and retry.</p>`);
        console.error(`\nAuthorization error received: ${error}`);
        server.close();
        process.exit(1);
        return;
      }

      if (code) {
        console.log('\nAuthorization code received. Exchanging for tokens...');
        
        const port = server.address().port;
        const redirectUri = `http://localhost:${port}`;
        const tokens = await exchangeCodeForTokens(keys, code, redirectUri);

        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
        console.log(`\nTokens saved successfully to: ${CREDENTIALS_PATH}`);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1 style="color: #10b981;">Google Drive MCP Authentication Successful!</h1>
            <p>Google Drive is now successfully connected.</p>
            <p>You can now safely close this window and return to Antigravity IDE.</p>
          </div>
        `);

        console.log('\n======================================================');
        console.log('  SUCCESS: Google Drive MCP is fully authenticated!');
        console.log('======================================================');
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1500);
      }
    } catch (err) {
      console.error('Callback handling error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Authentication failed: ' + err.message);
      server.close();
      process.exit(1);
    }
  });
}

function exchangeCodeForTokens(keys, code, redirectUri) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Token exchange failed (${res.statusCode}): ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const arg = process.argv[2];
if (arg === '--auth') {
  runSelfContainedAuth();
} else {
  checkStatus();
}
