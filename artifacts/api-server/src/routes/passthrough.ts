import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { logger } from "../lib/logger";
import { applyBillingAnthropic } from "../lib/billing";

const router = Router();

// Pipe an Anthropic SSE stream to `res`, rewriting usage in message_start events.
async function pipeAnthropicStreamWithUsageAdjust(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";

  const writeLine = (line: string) => {
    if (!line.startsWith("data: ")) { res.write(line + "\n"); return; }
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") { res.write(line + "\n"); return; }
    try {
      const e = JSON.parse(raw);
      // message_start: adjust input/cache usage (Anthropic native + Vertex AI)
      if (e.type === "message_start" && e.message?.usage) {
        const rawUsage = e.message.usage;
        logger.info(
          {
            input_tokens: rawUsage.input_tokens,
            cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
            event: "message_start",
          },
          "Anthropic raw usage (before billing adjustment)",
        );
        const adjustedUsage = applyBillingAnthropic(rawUsage);
        e.message.usage = adjustedUsage;
        logger.info(
          {
            input_tokens: adjustedUsage.input_tokens,
            cache_creation_input_tokens: adjustedUsage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: adjustedUsage.cache_read_input_tokens ?? 0,
            event: "message_start",
          },
          "Anthropic adjusted usage (after billing, sent to client)",
        );
        res.write(`data: ${JSON.stringify(e)}\n`);
        return;
      }
      // message_delta: Vertex AI also sends full usage here — AxonHub reads this last,
      // so we must adjust it too, otherwise the raw values overwrite message_start adjustments.
      if (e.type === "message_delta" && e.usage && (
        e.usage.cache_read_input_tokens || e.usage.input_tokens || e.usage.cache_creation_input_tokens
      )) {
        logger.info(
          {
            input_tokens: e.usage.input_tokens ?? 0,
            cache_creation_input_tokens: e.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: e.usage.cache_read_input_tokens ?? 0,
            event: "message_delta",
          },
          "Anthropic raw usage (before billing adjustment)",
        );
        e.usage = applyBillingAnthropic(e.usage);
        // preserve output_tokens which applyBillingAnthropic keeps if present
        logger.info(
          {
            input_tokens: e.usage.input_tokens ?? 0,
            cache_creation_input_tokens: e.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: e.usage.cache_read_input_tokens ?? 0,
            event: "message_delta",
          },
          "Anthropic adjusted usage (after billing, sent to client)",
        );
        res.write(`data: ${JSON.stringify(e)}\n`);
        return;
      }
    } catch {}
    res.write(line + "\n");
  };

  // Send SSE comment pings every 15s to prevent proxy from cutting long streams.
  const keepalive = setInterval(() => {
    if (!res.destroyed) res.write(": ping\n\n");
  }, 15000);

  try {
    for (;;) {
      if (res.destroyed) { reader.cancel().catch(() => {}); break; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) writeLine(line);
    }
    if (buf && !res.destroyed) res.write(buf);
    if (!res.destroyed) res.end();
  } finally {
    clearInterval(keepalive);
  }
}

// ─── Generic passthrough helper ──────────────────────────────────────────────
async function passthrough(
  req: Request,
  res: Response,
  baseUrl: string,
  authHeader: string,
  subPath: string,
  stripV1 = true,
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>,
  adjustUsage = false,
) {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const upstreamPath = (stripV1 ? subPath.replace(/^\/v1\//, "") : subPath).replace(/^\//, "");
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target = `${cleanBase}/${upstreamPath}${query}`;

  const headers: Record<string, string> = { Authorization: authHeader };
  if (req.headers["content-type"])      headers["Content-Type"]       = req.headers["content-type"] as string;
  if (req.headers["anthropic-version"]) headers["anthropic-version"]  = req.headers["anthropic-version"] as string;

  // Merge client beta flags with proxy-required ones.
  // prompt-caching-2024-07-31 enables cache_control blocks with ttl: "1h" (1h lifetime).
  const clientBeta = req.headers["anthropic-beta"] as string | undefined;
  const requiredBetas = ["prompt-caching-2024-07-31"];
  const mergedBetas = Array.from(new Set([
    ...(clientBeta ? clientBeta.split(",").map(s => s.trim()).filter(Boolean) : []),
    ...requiredBetas,
  ]));
  headers["anthropic-beta"] = mergedBetas.join(",");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let bodyObj: Record<string, unknown> | undefined =
    hasBody && req.body && Object.keys(req.body).length > 0 ? req.body : undefined;

  if (bodyObj && transformBody) {
    bodyObj = transformBody(bodyObj);
  }

  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;

  // Log key request params (never log full messages content)
  const { model, temperature, top_p, max_tokens, stream, tools } = bodyObj ?? {};
  logger.info(
    {
      method: req.method,
      target,
      model,
      temperature,
      top_p,
      max_tokens,
      stream: !!stream,
      tools: Array.isArray(tools) ? tools.length : undefined,
    },
    "Passthrough request",
  );

  const up = await fetch(target, { method: req.method, headers, body: bodyStr });

  const ct = up.headers.get("content-type") || "application/json";
  const isStream = ct.includes("text/event-stream") || ct.includes("application/stream");

  res.status(up.status);
  res.setHeader("Content-Type", ct);

  // ── Error: read body, log details, then forward ───────────────────────────
  if (!up.ok) {
    const raw = await up.text().catch(() => "");
    let errBody: unknown;
    try { errBody = JSON.parse(raw); } catch { errBody = raw || up.statusText; }

    logger.warn(
      {
        status: up.status,
        target,
        method: req.method,
        model,
        temperature,
        top_p,
        upstreamError: errBody,
      },
      `Upstream ${up.status} error`,
    );

    res.end(raw);
    return;
  }

  // ── Success: stream or buffer ─────────────────────────────────────────────
  if (isStream && up.body) {
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const reader = up.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    if (adjustUsage) {
      await pipeAnthropicStreamWithUsageAdjust(reader, res);
    } else {
      const keepalive = setInterval(() => {
        if (!res.destroyed) res.write(": ping\n\n");
      }, 15000);
      try {
        for (;;) {
          if (res.destroyed) { reader.cancel().catch(() => {}); break; }
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        if (!res.destroyed) res.end();
      } finally {
        clearInterval(keepalive);
      }
    }
    return;
  }

  if (adjustUsage) {
    const arrayBuf = await up.arrayBuffer();
    try {
      const d = JSON.parse(Buffer.from(arrayBuf).toString());
      if (d?.usage) d.usage = applyBillingAnthropic(d.usage);
      res.end(JSON.stringify(d));
    } catch {
      res.end(Buffer.from(arrayBuf));
    }
    return;
  }
  res.end(Buffer.from(await up.arrayBuffer()));
}

// ─── Anthropic body sanitizer ─────────────────────────────────────────────────

// Strip unsupported `scope` field from a cache_control object.
// Vertex AI only accepts { "type": "ephemeral" } — the `scope` field is not permitted.
function stripCacheControlScope(cc: unknown): unknown {
  if (cc && typeof cc === "object" && "scope" in cc) {
    const { scope, ...rest } = cc as Record<string, unknown>;
    logger.warn({ scope }, "Anthropic: removed unsupported cache_control.scope field");
    return rest;
  }
  return cc;
}

// Apply scope stripping to every cache_control found in system / messages / tools arrays.
function stripAllCacheControlScopes(body: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const result = { ...body };

  // system: array of content blocks
  if (Array.isArray(result.system)) {
    result.system = result.system.map((block: any) => {
      if (block?.cache_control) {
        const cc = stripCacheControlScope(block.cache_control);
        if (cc !== block.cache_control) { changed = true; return { ...block, cache_control: cc }; }
      }
      return block;
    });
  }

  // messages[n].content[m]: strip cache_control.scope only
  // NOTE: thinking blocks (type:"thinking") must be passed through as-is with their
  // signature intact — Vertex AI requires the signature field and will reject requests
  // where it is missing.
  if (Array.isArray(result.messages)) {
    result.messages = result.messages.map((msg: any) => {
      if (!Array.isArray(msg?.content)) return msg;
      const content = msg.content.map((block: any) => {
        let b = block;
        if (b?.cache_control) {
          const cc = stripCacheControlScope(b.cache_control);
          if (cc !== b.cache_control) { changed = true; b = { ...b, cache_control: cc }; }
        }
        return b;
      });
      return { ...msg, content };
    });
  }

  // tools[n].cache_control
  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map((tool: any) => {
      if (tool?.cache_control) {
        const cc = stripCacheControlScope(tool.cache_control);
        if (cc !== tool.cache_control) { changed = true; return { ...tool, cache_control: cc }; }
      }
      return tool;
    });
  }

  if (changed) {
    logger.warn({ model: result.model }, "Anthropic: stripped cache_control.scope from request body");
  }
  return result;
}

// ─── Cache-control helpers (aligned with CPA behavior) ───────────────────────

// Count all cache_control breakpoints across system / tools / messages.
function countCacheControls(body: Record<string, unknown>): number {
  let n = 0;
  if (Array.isArray(body.system)) {
    for (const b of body.system as any[]) if (b?.cache_control) n++;
  }
  if (Array.isArray(body.tools)) {
    for (const t of body.tools as any[]) if (t?.cache_control) n++;
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages as any[]) {
      if (Array.isArray(msg?.content)) {
        for (const b of msg.content) if (b?.cache_control) n++;
      }
    }
  }
  return n;
}

// Auto-inject default cache breakpoints when the client provided none.
// Gate is global (CPA-style): if ANY cache_control already exists anywhere,
// skip all injection — no partial filling.
function injectCacheControl(body: Record<string, unknown>): Record<string, unknown> {
  if (countCacheControls(body) > 0) return body;

  const result = { ...body };

  // ── Tools: last tool is the cache breakpoint for all tool definitions ─────
  if (Array.isArray(result.tools) && result.tools.length > 0) {
    const tools = [...result.tools];
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral", ttl: "1h" } };
    result.tools = tools;
  }

  // ── System: convert string → block array, mark last block ────────────────
  if (result.system !== undefined) {
    let sysBlocks: any[];
    if (typeof result.system === "string") {
      sysBlocks = [{ type: "text", text: result.system }];
    } else if (Array.isArray(result.system)) {
      sysBlocks = [...result.system];
    } else {
      sysBlocks = [];
    }
    if (sysBlocks.length > 0) {
      sysBlocks[sysBlocks.length - 1] = { ...sysBlocks[sysBlocks.length - 1], cache_control: { type: "ephemeral", ttl: "1h" } };
      result.system = sysBlocks;
    }
  }

  // ── Messages: breakpoint on the last content block of the second-to-last ─
  // user turn — caches conversation history while keeping the newest message
  // fresh (requires at least 2 messages).
  if (Array.isArray(result.messages) && result.messages.length > 1) {
    const messages = [...result.messages];
    const target = { ...messages[messages.length - 2] };
    if (Array.isArray(target.content) && target.content.length > 0) {
      const content = [...target.content];
      content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: "ephemeral", ttl: "1h" } };
      target.content = content;
      messages[messages.length - 2] = target;
      result.messages = messages;
    } else if (typeof target.content === "string") {
      target.content = [{ type: "text", text: target.content, cache_control: { type: "ephemeral", ttl: "1h" } }];
      messages[messages.length - 2] = target;
      result.messages = messages;
    }
  }

  return result;
}

// Enforce Anthropic's hard limit of at most `limit` cache_control breakpoints.
// When trimming, lower-value breakpoints are removed first:
//   phase 1 — earlier system blocks (preserve the last system block)
//   phase 2 — earlier tool blocks   (preserve the last tool block)
//   phase 3 — message blocks, earliest first
//   phase 4 — remaining system blocks
//   phase 5 — remaining tool blocks
function enforceCacheControlLimit(body: Record<string, unknown>, limit: number): Record<string, unknown> {
  const total = countCacheControls(body);
  if (total <= limit) return body;

  let toRemove = total - limit;
  const result = { ...body };

  logger.warn(
    { model: result.model, total, limit },
    `Anthropic: trimming cache_control breakpoints from ${total} to ${limit}`,
  );

  function removeFromArray(
    arr: any[],
    hasCc: (item: any) => boolean,
    deleteCc: (item: any) => any,
    preserveLastWithCc: boolean,
  ): any[] {
    if (toRemove <= 0) return arr;
    const out = [...arr];
    const lastCcIdx = preserveLastWithCc
      ? out.reduce((last, item, i) => (hasCc(item) ? i : last), -1)
      : -1;
    for (let i = 0; i < out.length && toRemove > 0; i++) {
      if (hasCc(out[i]) && i !== lastCcIdx) {
        out[i] = deleteCc(out[i]);
        toRemove--;
      }
    }
    return out;
  }

  // Phase 1: earlier system blocks (keep last)
  if (toRemove > 0 && Array.isArray(result.system)) {
    result.system = removeFromArray(
      result.system as any[],
      (b) => !!b?.cache_control,
      (b) => { const { cache_control, ...rest } = b; return rest; },
      true,
    );
  }

  // Phase 2: earlier tool blocks (keep last)
  if (toRemove > 0 && Array.isArray(result.tools)) {
    result.tools = removeFromArray(
      result.tools as any[],
      (t) => !!t?.cache_control,
      (t) => { const { cache_control, ...rest } = t; return rest; },
      true,
    );
  }

  // Phase 3: message content blocks, earliest message/block first
  if (toRemove > 0 && Array.isArray(result.messages)) {
    const messages = [...result.messages as any[]];
    for (let mi = 0; mi < messages.length && toRemove > 0; mi++) {
      const msg = messages[mi];
      if (!Array.isArray(msg?.content)) continue;
      const content = [...msg.content];
      for (let ci = 0; ci < content.length && toRemove > 0; ci++) {
        if (content[ci]?.cache_control) {
          const { cache_control, ...rest } = content[ci];
          content[ci] = rest;
          toRemove--;
        }
      }
      messages[mi] = { ...msg, content };
    }
    result.messages = messages;
  }

  // Phase 4: remaining system blocks
  if (toRemove > 0 && Array.isArray(result.system)) {
    result.system = removeFromArray(
      result.system as any[],
      (b) => !!b?.cache_control,
      (b) => { const { cache_control, ...rest } = b; return rest; },
      false,
    );
  }

  // Phase 5: remaining tool blocks
  if (toRemove > 0 && Array.isArray(result.tools)) {
    result.tools = removeFromArray(
      result.tools as any[],
      (t) => !!t?.cache_control,
      (t) => { const { cache_control, ...rest } = t; return rest; },
      false,
    );
  }

  return result;
}

// Normalize TTL ordering across cache_control blocks.
// Anthropic evaluates breakpoints in this order: tools → system → messages.
// Once a default (non-1h) block appears in that order, a later ttl:"1h" block
// is invalid. CPA handles this by downgrading (deleting the ttl field from the
// later block) rather than rejecting the request.
function normalizeCacheControlTTL(body: Record<string, unknown>): Record<string, unknown> {
  let seenDefault = false;
  let changed = false;
  const result = { ...body };

  function processItem(item: any, update: (next: any) => void): void {
    const cc = item?.cache_control;
    if (!cc) return;
    const isOneHour = typeof cc === "object" && cc.ttl === "1h";
    if (!isOneHour) {
      seenDefault = true;
    } else if (seenDefault) {
      const { ttl, ...rest } = cc as any;
      update({ ...item, cache_control: rest });
      changed = true;
    }
  }

  // Evaluation order: tools → system → messages
  if (Array.isArray(result.tools)) {
    const tools = [...result.tools as any[]];
    for (let i = 0; i < tools.length; i++) processItem(tools[i], (v) => { tools[i] = v; });
    result.tools = tools;
  }

  if (Array.isArray(result.system)) {
    const sys = [...result.system as any[]];
    for (let i = 0; i < sys.length; i++) processItem(sys[i], (v) => { sys[i] = v; });
    result.system = sys;
  }

  if (Array.isArray(result.messages)) {
    const messages = [...result.messages as any[]];
    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      if (!Array.isArray(msg?.content)) continue;
      const content = [...msg.content];
      for (let ci = 0; ci < content.length; ci++) {
        processItem(content[ci], (v) => { content[ci] = v; });
      }
      messages[mi] = { ...msg, content };
    }
    result.messages = messages;
  }

  if (changed) {
    logger.warn(
      { model: result.model },
      "Anthropic: downgraded later ttl:1h cache_control blocks — a default (5m) block appeared earlier in evaluation order",
    );
  }

  return result;
}

// Upgrade all cache_control blocks without a ttl to use ttl: "1h".
// Anthropic's default ephemeral TTL is only 5 minutes; 1h avoids cache misses
// between requests that are more than 5 minutes apart.
function upgradeCacheControlTo1h(body: Record<string, unknown>): Record<string, unknown> {
  function upgradeCC(cc: unknown): unknown {
    if (!cc || typeof cc !== "object") return cc;
    const obj = cc as Record<string, unknown>;
    if (obj.type === "ephemeral" && !("ttl" in obj)) return { ...obj, ttl: "1h" };
    return cc;
  }
  function upgradeBlock(block: any): any {
    if (!block?.cache_control) return block;
    const upgraded = upgradeCC(block.cache_control);
    return upgraded !== block.cache_control ? { ...block, cache_control: upgraded } : block;
  }

  const result = { ...body };
  let changed = false;

  if (Array.isArray(result.system)) {
    const sys = (result.system as any[]).map(upgradeBlock);
    if (sys.some((b, i) => b !== (result.system as any[])[i])) { result.system = sys; changed = true; }
  }
  if (Array.isArray(result.tools)) {
    const tools = (result.tools as any[]).map(upgradeBlock);
    if (tools.some((t, i) => t !== (result.tools as any[])[i])) { result.tools = tools; changed = true; }
  }
  if (Array.isArray(result.messages)) {
    const messages = (result.messages as any[]).map((msg: any) => {
      if (!Array.isArray(msg?.content)) return msg;
      const content = (msg.content as any[]).map(upgradeBlock);
      return content.some((b, i) => b !== msg.content[i]) ? { ...msg, content } : msg;
    });
    if (messages.some((m, i) => m !== (result.messages as any[])[i])) { result.messages = messages; changed = true; }
  }

  if (changed) logger.info({ model: result.model }, "Upgraded cache_control TTL: ephemeral (5min) → 1h");
  return result;
}

// Strip thinking blocks that are missing a `signature` field.
// Anthropic requires the `signature` field on every thinking block sent back in
// conversation history (it uses it to verify the block wasn't tampered with).
// Blocks without a signature are either client-constructed fakes or ones that
// lost their signature in transit — forwarding them causes a 400 "Field required".
function stripUnsignedThinkingBlocks(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  let dropped = 0;
  const messages = (body.messages as any[]).map((msg: any) => {
    if (!Array.isArray(msg?.content)) return msg;
    const filtered = msg.content.filter((block: any) => {
      if (block?.type !== "thinking") return true;  // keep non-thinking blocks as-is
      if (block.signature) return true;              // valid thinking block — keep
      dropped++;
      return false;                                  // unsigned thinking block — drop
    });
    return filtered.length !== msg.content.length ? { ...msg, content: filtered } : msg;
  });
  if (dropped > 0) {
    logger.warn(
      { model: body.model, dropped },
      "Anthropic: dropped thinking block(s) without signature — client must echo signature from prior response",
    );
  }
  return dropped > 0 ? { ...body, messages } : body;
}

// Anthropic rejects requests that set both temperature and top_p simultaneously.
// When both are present, drop top_p and keep temperature (lower latency impact).
// Anthropic also rejects tools: [] (empty array) — remove it entirely.
function sanitizeAnthropicBody(body: Record<string, unknown>): Record<string, unknown> {
  let result = stripUnsignedThinkingBlocks(body);
  result = stripAllCacheControlScopes(result);

  if (result.temperature !== undefined && result.top_p !== undefined) {
    const { top_p, ...rest } = result as any;
    logger.warn(
      { temperature: result.temperature, top_p },
      "Anthropic: removed top_p — cannot specify both temperature and top_p; keeping temperature",
    );
    result = rest;
  }

  // Anthropic rejects tools: [] — remove the field when the array is empty
  if (Array.isArray(result.tools) && (result.tools as unknown[]).length === 0) {
    const { tools, ...rest } = result as any;
    logger.warn({}, "Anthropic: removed empty tools array — Anthropic rejects tools: []");
    result = rest;
  }

  const clientCCCount = countCacheControls(result);

  // Compute system prompt fingerprint BEFORE injection (raw text from client).
  let sysHash = "none";
  let sysLen = 0;
  if (Array.isArray(result.system)) {
    const sysText = (result.system as any[]).map((b: any) => b?.text ?? "").join("");
    sysLen = sysText.length;
    sysHash = createHash("sha1").update(sysText).digest("hex").slice(0, 12);
  } else if (typeof result.system === "string") {
    sysLen = (result.system as string).length;
    sysHash = createHash("sha1").update(result.system as string).digest("hex").slice(0, 12);
  }

  result = injectCacheControl(result);           // step 1: inject if client sent none
  result = upgradeCacheControlTo1h(result);      // step 2: upgrade all ephemeral TTL to 1h
  result = enforceCacheControlLimit(result, 4);  // step 3: trim to Anthropic's hard limit of 4
  result = normalizeCacheControlTTL(result);     // step 4: downgrade invalid later ttl:1h blocks
  const finalCCCount = countCacheControls(result);
  logger.info(
    {
      model: result.model,
      clientHadCacheControl: clientCCCount > 0,
      clientCCCount,
      finalCCCount,
      msgCount: Array.isArray(result.messages) ? (result.messages as unknown[]).length : 0,
      sysHash,
      sysLen,
    },
    "Anthropic cache_control state",
  );
  return result;
}

// ─── Provider config ──────────────────────────────────────────────────────────
interface ProviderConfig {
  envPrefix: string;
  stripV1: boolean;
  transformBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  adjustUsage?: boolean;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: { envPrefix: "ANTHROPIC", stripV1: true,  transformBody: sanitizeAnthropicBody, adjustUsage: true },
  openai:    { envPrefix: "OPENAI",    stripV1: true  },
  gemini:    { envPrefix: "GEMINI",    stripV1: false },
};

function makeHandler({ envPrefix, stripV1, transformBody, adjustUsage }: ProviderConfig) {
  return async (req: Request, res: Response) => {
    const baseUrl = process.env[`AI_INTEGRATIONS_${envPrefix}_BASE_URL`] || "";
    const key     = process.env[`AI_INTEGRATIONS_${envPrefix}_API_KEY`]  || "";
    if (!baseUrl || !key) {
      res.status(503).json({ error: { message: `${envPrefix} integration not configured`, type: "service_unavailable" } });
      return;
    }
    try {
      await passthrough(req, res, baseUrl, `Bearer ${key}`, req.path, stripV1, transformBody, adjustUsage ?? false);
    } catch (err) {
      logger.error({ err, envPrefix }, "Passthrough error");
      if (!res.headersSent) res.status(500).json({ error: { message: "Passthrough error", type: "server_error" } });
    }
  };
}

// ─── Anthropic models list (Replit integration doesn't support GET /models) ──
const ANTHROPIC_MODELS = [
  "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-4-6", "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307",
];

const now = new Date().toISOString();
const anthropicModelList = {
  data: ANTHROPIC_MODELS.map((id) => ({
    type: "model",
    id,
    display_name: id,
    created_at: now,
  })),
};

for (const [name, config] of Object.entries(PROVIDERS)) {
  const sub = Router();
  if (name === "anthropic") {
    sub.get("/v1/models", (_req, res) => res.json(anthropicModelList));
    sub.get("/models",    (_req, res) => res.json(anthropicModelList));
  }
  sub.use("/", makeHandler(config));
  router.use(`/${name}`, sub);
}

export default router;
