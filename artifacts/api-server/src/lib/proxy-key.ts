import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const KEY_DIR  = join(process.cwd(), ".data");
const KEY_FILE = join(KEY_DIR, "proxy-key");

function generate(): string {
  return "sk-proxy-" + randomBytes(16).toString("hex");
}

function load(): string {
  try {
    const saved = readFileSync(KEY_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    // file doesn't exist yet
  }
  const key = generate();
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_FILE, key, "utf8");
  return key;
}

// ⚠️  DEPLOYMENT NOTE:
// In production, the .data/proxy-key file is NOT persisted across redeploys.
// If PROXY_API_KEY is not set, a new random key is generated on every deploy,
// which breaks all existing clients that have stored the old key (they will
// start receiving 401 Unauthorized errors).
//
// Fix: Set PROXY_API_KEY as a persistent environment variable/secret in your
// deployment platform BEFORE the first deploy. Generate one with:
//   node -e "console.log('sk-proxy-' + require('crypto').randomBytes(16).toString('hex'))"
// Then set the output as PROXY_API_KEY in Replit Secrets or your env config.
//
// See DEPLOYMENT.md for full setup instructions.
if (process.env["NODE_ENV"] === "production" && !process.env["PROXY_API_KEY"]) {
  console.error(
    "[proxy-key] WARNING: PROXY_API_KEY is not set in production. " +
    "A new random key will be generated and will CHANGE on every redeploy. " +
    "All clients that have stored the old key will receive 401 Unauthorized. " +
    "Set PROXY_API_KEY as a persistent environment variable to fix this. " +
    "See DEPLOYMENT.md for instructions.",
  );
}

// Prefer explicit env var (stable across redeploys), otherwise persist a generated key locally.
export const PROXY_API_KEY: string =
  process.env["PROXY_API_KEY"] || load();
