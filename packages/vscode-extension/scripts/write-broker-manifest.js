const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const brokerRoot = path.join(extensionRoot, "out", "broker");
const serverModule = require(path.join(brokerRoot, "server.js"));
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));

function collectRuntimeFiles(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(fullPath, base);
    const relativePath = path.relative(base, fullPath).split(path.sep).join("/");
    return relativePath.endsWith(".js") && !relativePath.endsWith(".d.ts") && !relativePath.endsWith(".map") ? [relativePath] : [];
  });
}

if (!fs.existsSync(path.join(brokerRoot, "index.js"))) {
  throw new Error("Broker output is missing out/broker/index.js; compile the extension before writing its manifest.");
}
const hash = crypto.createHash("sha256");
for (const relativePath of collectRuntimeFiles(brokerRoot).sort()) {
  hash.update(relativePath, "utf8");
  hash.update(Buffer.from([0]));
  hash.update(fs.readFileSync(path.join(brokerRoot, relativePath)));
}
const manifest = {
  brokerVersion: packageJson.version,
  schemaVersion: serverModule.BROKER_SCHEMA_VERSION,
  capabilities: [...serverModule.BROKER_CAPABILITIES],
  entrypoint: "index.js",
  assetRoot: "../..",
  sourceDigest: hash.digest("hex"),
};
fs.writeFileSync(path.join(brokerRoot, "broker-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
