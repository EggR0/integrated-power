const fs = require('fs');
const path = require('path');
const os = require('os');

function searchDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      searchDir(p);
    } else if (e.isFile()) {
      try {
        const stat = fs.statSync(p);
        // within last 7 days
        if (Date.now() - stat.mtimeMs < 7 * 24 * 3600 * 1000) {
          const content = fs.readFileSync(p);
          if (content.includes('rate_limits') || content.includes('used_percent')) {
            console.log('Recent file with rate_limits:', p, new Date(stat.mtimeMs).toISOString());
            const text = content.toString('utf8');
            const matches = text.match(/"used_percent":\s*(\d+)/g);
            if (matches) console.log('  matches:', matches.slice(-5));
          }
        }
      } catch {}
    }
  }
}

console.log('Searching .codex...');
searchDir(path.join(os.homedir(), '.codex'));
console.log('Done.');
