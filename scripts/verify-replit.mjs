const defaultPort = process.env.PORT || "3000";
const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg ? baseUrlArg.slice("--base-url=".length) : process.env.REPLIT_BASE_URL)
  || `http://127.0.0.1:${defaultPort}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function fetchText(pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const text = await response.text();

  return {
    response,
    text,
    contentType: response.headers.get("content-type") || "",
  };
}

function assertOk(response, pathname) {
  if (!response.ok) {
    fail(`GET ${pathname} failed with ${response.status}`);
  }
}

function assertJson(contentType, pathname) {
  if (!contentType.includes("application/json")) {
    fail(`GET ${pathname} expected JSON but got ${contentType || "unknown content-type"}`);
  }
}

function parseJson(text, pathname) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`GET ${pathname} did not return valid JSON: ${error}`);
  }
}

async function verifyRoot() {
  const pathname = "/";
  const { response, text, contentType } = await fetchText(pathname);

  assertOk(response, pathname);
  if (!contentType.includes("text/html")) {
    fail(`GET ${pathname} expected HTML but got ${contentType || "unknown content-type"}`);
  }

  if (!text.includes("<!DOCTYPE html") && !text.includes("<div id=\"root\">")) {
    fail(`GET ${pathname} did not return the built status page HTML`);
  }

  console.log(`verify: GET ${pathname} -> HTML`);
}

async function verifyHealthz() {
  const pathname = "/api/healthz";
  const { response, text, contentType } = await fetchText(pathname);

  assertOk(response, pathname);
  assertJson(contentType, pathname);
  const body = parseJson(text, pathname);
  if (body?.status !== "ok") {
    fail(`GET ${pathname} returned unexpected payload: ${text}`);
  }

  console.log(`verify: GET ${pathname} -> JSON`);
}

async function verifyProxyInfo() {
  const pathname = "/api/proxy-info";
  const { response, text, contentType } = await fetchText(pathname);

  assertOk(response, pathname);
  assertJson(contentType, pathname);
  const body = parseJson(text, pathname);
  const anthropicConfigured = body?.integrations?.anthropic?.configured === true;
  const geminiConfigured = body?.integrations?.gemini?.configured === true;

  if (!anthropicConfigured && !geminiConfigured) {
    fail(`GET ${pathname} reported no configured providers: ${text}`);
  }

  console.log(`verify: GET ${pathname} -> anthropic=${anthropicConfigured} gemini=${geminiConfigured}`);
  return { anthropicConfigured, geminiConfigured };
}

async function verifyAnthropicModels() {
  const pathname = "/api/anthropic/v1/models";
  const { response, text, contentType } = await fetchText(pathname);

  assertOk(response, pathname);
  assertJson(contentType, pathname);
  const body = parseJson(text, pathname);
  const models = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
        : null;

  if (!models || models.length === 0) {
    fail(`GET ${pathname} returned an unexpected payload: ${text}`);
  }

  console.log(`verify: GET ${pathname} -> ${models.length} models`);
}

async function verifyGeminiModels() {
  const pathname = "/api/gemini/v1beta/models";
  const { response, text, contentType } = await fetchText(pathname);

  assertOk(response, pathname);
  assertJson(contentType, pathname);
  const body = parseJson(text, pathname);
  const models = Array.isArray(body)
    ? body
    : Array.isArray(body?.models)
      ? body.models
      : Array.isArray(body?.data)
      ? body.data
      : null;

  if (!models || models.length === 0) {
    fail(`GET ${pathname} returned an unexpected payload: ${text}`);
  }

  console.log(`verify: GET ${pathname} -> ${models.length} models`);
}

try {
  await verifyRoot();
  await verifyHealthz();
  const providers = await verifyProxyInfo();
  if (providers.anthropicConfigured) {
    await verifyAnthropicModels();
  }
  if (providers.geminiConfigured) {
    await verifyGeminiModels();
  }
  console.log(`verify: Replit runtime checks passed for ${baseUrl}`);
} catch (error) {
  fail(`verify: unexpected failure: ${error instanceof Error ? error.stack || error.message : String(error)}`);
}
