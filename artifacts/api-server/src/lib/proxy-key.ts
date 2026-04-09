import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));

export const PROXY_KEY_DIR = join(PACKAGE_DIR, ".data");
export const PROXY_KEY_FILE = join(PROXY_KEY_DIR, "proxy-key");

function generate(): string {
  return "sk-proxy-" + randomBytes(16).toString("hex");
}

/**
 * Load the proxy key from the persistent file, or generate and save one on first boot.
 * The file is written once and reused on every subsequent start/redeploy.
 * To override (e.g. after a full container reset), set PROXY_API_KEY as a Replit Secret.
 */
function load(): string {
  try {
    const saved = readFileSync(PROXY_KEY_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    // file doesn't exist yet — first boot
  }
  const key = generate();
  mkdirSync(PROXY_KEY_DIR, { recursive: true });
  writeFileSync(PROXY_KEY_FILE, key, "utf8");
  return key;
}

// Priority: explicit env var (most stable) → persisted file (generated once on first boot).
// In production the file survives redeploys as long as the container is not fully reset.
// If you ever reset the container or lose the file, set PROXY_API_KEY as a Replit Secret
// before redeploying so clients don't receive unexpected 401 errors.
export const PROXY_API_KEY: string =
  process.env["PROXY_API_KEY"] || load();
