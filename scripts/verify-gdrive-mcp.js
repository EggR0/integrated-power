// scripts/verify-gdrive-mcp.js
// Verification suite for Google Drive MCP unlazy gates

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const arg = process.argv[2];

if (arg === '--check-package') {
  try {
    // Verify that @modelcontextprotocol/server-gdrive is installed/runnable via npx
    let output = '';
    try {
      output = execSync('npx.cmd -y @modelcontextprotocol/server-gdrive', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      output = (err.stdout || '') + (err.stderr || '');
    }
    if (output.includes('Credentials not found') || output.includes('auth')) {
      console.log('gdrive mcp package verified');
      process.exit(0);
    } else {
      console.error('Unexpected output:', output);
      process.exit(1);
    }
  } catch (e) {
    console.error('Package verification failed:', e);
    process.exit(1);
  }
} else if (arg === '--check-helper') {
  const helperPath = path.join(__dirname, 'setup-gdrive-mcp.js');
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\jsp0';
  const configDir = path.join(homeDir, '.config', 'google-drive-mcp');

  if (fs.existsSync(helperPath) && fs.existsSync(configDir)) {
    const helperContent = fs.readFileSync(helperPath, 'utf-8');
    if (helperContent.includes('GDRIVE_OAUTH_PATH') && helperContent.includes('GDRIVE_CREDENTIALS_PATH')) {
      console.log('gdrive helper script verified');
      process.exit(0);
    }
  }
  console.error('Helper or config directory missing or invalid');
  process.exit(1);
} else if (arg === '--check-guide') {
  const guidePath = path.join(__dirname, '..', 'docs', 'guides', 'google-drive-mcp-setup.ko.md');
  if (fs.existsSync(guidePath)) {
    const content = fs.readFileSync(guidePath, 'utf-8');
    const requiredSections = [
      'Google Cloud Console',
      'OAuth 클라이언트',
      'gcp-oauth.keys.json',
      '.gdrive-server-credentials.json',
      'mcp_config.json',
      'Test users',
    ];
    const allFound = requiredSections.every((s) => content.includes(s));
    if (allFound) {
      console.log('gdrive setup guide verified');
      process.exit(0);
    }
  }
  console.error('Guide file missing or incomplete');
  process.exit(1);
} else if (arg === '--check-mcp-config') {
  const mcpConfigPath = path.join(
    process.env.USERPROFILE || 'C:\\Users\\jsp0',
    '.gemini',
    'config',
    'mcp_config.json'
  );
  if (fs.existsSync(mcpConfigPath)) {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    const gdrive = config.mcpServers?.gdrive;
    if (
      gdrive &&
      gdrive.env?.GDRIVE_OAUTH_PATH &&
      gdrive.env?.GDRIVE_CREDENTIALS_PATH
    ) {
      console.log('gdrive mcp config verified');
      process.exit(0);
    }
  }
  console.error('mcp_config.json missing gdrive entry or invalid');
  process.exit(1);
} else if (arg === '--check-storage-broker') {
  const refPath = path.join(
    __dirname,
    '..',
    'docs',
    'reference',
    'google-drive-storage-broker.ko.md'
  );
  const reuseMapPath = path.join(__dirname, '..', 'docs', 'reuse-map.md');
  const hasRef = fs.existsSync(refPath);
  const hasReuse = fs.existsSync(reuseMapPath);
  if (hasRef && hasReuse) {
    const reuseContent = fs.readFileSync(reuseMapPath, 'utf-8');
    if (reuseContent.includes('Google Drive MCP storage')) {
      console.log('storage broker reference verified');
      process.exit(0);
    }
  }
  console.error('Storage broker reference or reuse-map missing');
  process.exit(1);
} else {
  console.error('Usage: node verify-gdrive-mcp.js [--check-package|--check-helper|--check-guide|--check-mcp-config|--check-storage-broker]');
  process.exit(1);
}
