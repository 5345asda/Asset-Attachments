import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { rid, now, getProviderCreds, routeModel, pipeStream } from "../lib/utils";
import { oaiMessagesToAnthropic, oaiToolsToAnthropic, oaiToolChoiceToAnthropic, anthropicToOaiResponse, streamAnthropic } from "../lib/format/anthropic";
import { oaiMessagesToGemini, geminiToOaiResponse, streamGemini } from "../lib/format/gemini";

const router = Router();

// ─── Models list ──────────────────────────────────────────────────────────────
router.get("/models", (_req: Request, res: Response) => {
  const models = [
    // Anthropic
    { id: "claude-opus-4-6",    owned_by: "anthropic" },
    { id: "claude-opus-4-5",    owned_by: "anthropic" },
    { id: "claude-opus-4-1",    owned_by: "anthropic" },
    { id: "claude-sonnet-4-6",  owned_by: "anthropic" },
    { id: "claude-sonnet-4-5",  owned_by: "anthropic" },
    { id: "claude-haiku-4-5",   owned_by: "anthropic" },
    // OpenAI
    { id: "gpt-5.2",            owned_by: "openai" },
    { id: "gpt-5.1",            owned_by: "openai" },
    { id: "gpt-5",              owned_by: "openai" },
    { id: "gpt-5-mini",         owned_by: "openai" },
    { id: "gpt-5-nano",         owned_by: "openai" },
    { id: "gpt-4.1",            owned_by: "openai" },
    { id: "gpt-4.1-mini",       owned_by: "openai" },
    { id: "gpt-4.1-nano",       owned_by: "openai" },
    { id: "gpt-4o",             owned_by: "openai" },
    { id: "gpt-4o-mini",        owned_by: "openai" },
    { id: "o4-mini",            owned_by: "openai" },
    { id: "o3",                 owned_by: "openai" },
    { id: "o3-mini",            owned_by: "openai" },
    // Google — supported by Replit AI Integration
    { id: "gemini-2.5-pro",   owned_by: "google" },
    { id: "gemini-2.5-flash", owned_by: "google" },
  ];
  res.json({ object: "list", data: models.map((m) => ({ ...m, object: "model", created: 1700000000 })) });
});

// ─── Chat completions ─────────────────────────────────────────────────────────
router.post("/chat/completions", async (req: Request, res: Response) => {
  const p = req.body;
  if (!p?.model) {
    res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    return;
  }

  const provider = routeModel(p.model);
  const { url, key } = getProviderCreds(provider);
  logger.info(
    {
      model: p.model,
      provider,
      stream: !!p.stream,
      tools: Array.isArray(p.tools) ? p.tools.length : 0,
      temperature: p.temperature,
      top_p: p.top_p,
      max_tokens: p.max_tokens,
      messages: Array.isArray(p.messages) ? p.messages.length : 0,
    },
    "Proxy request",
  );

  if (!url || !key) {
    res.status(503).json({ error: { message: `Provider credentials for '${provider}' are not configured`, type: "service_unavailable" } });
    return;
  }

  try {
    // ── OpenAI / OpenRouter — direct pass-through ──────────────────────────
    if (provider === "openai" || provider === "openrouter") {
      const up = await fetch(`${url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(p),
      });
      if (p.stream) {
        res.writeHead(up.status, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        return pipeStream(up.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>, res);
      }
      const body = await up.json();
      if (!up.ok) {
        logger.warn({ status: up.status, model: p.model, provider, upstreamError: body }, `${provider} upstream error`);
      }
      res.status(up.status).json(body);
      return;
    }

    // ── Anthropic — full protocol translation ──────────────────────────────
    if (provider === "anthropic") {
      const systemMsg = (p.messages || []).find((m: any) => m.role === "system");
      // Anthropic rejects requests that set both temperature and top_p.
      // When both are present, drop top_p and keep temperature.
      const hasTemperature = p.temperature !== undefined;
      const hasTopP = p.top_p !== undefined;
      if (hasTemperature && hasTopP) {
        logger.warn(
          { temperature: p.temperature, top_p: p.top_p, model: p.model },
          "Anthropic: removed top_p — cannot specify both temperature and top_p; keeping temperature",
        );
      }

      // ── Convert messages, then inject a cache breakpoint on the penultimate ──
      // turn so that conversation history is cached while only the latest user
      // message is treated as new input.
      const convertedMessages = oaiMessagesToAnthropic(p.messages || []);
      if (convertedMessages.length > 1) {
        const target = convertedMessages[convertedMessages.length - 2];
        if (Array.isArray(target.content) && target.content.length > 0) {
          const lastBlock = target.content[target.content.length - 1];
          target.content[target.content.length - 1] = { ...lastBlock, cache_control: { type: "ephemeral" } };
        } else if (typeof target.content === "string") {
          convertedMessages[convertedMessages.length - 2] = {
            ...target,
            content: [{ type: "text", text: target.content, cache_control: { type: "ephemeral" } }],
          };
        }
      }

      // ── System: convert to a cacheable content block array ────────────────
      const systemText = systemMsg
        ? (typeof systemMsg.content === "string" ? systemMsg.content : JSON.stringify(systemMsg.content))
        : null;

      const body: any = {
        model: p.model,
        max_tokens: p.max_tokens || 8192,
        messages: convertedMessages,
        ...(systemText && { system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }] }),
        ...(p.stream && { stream: true }),
        ...(hasTemperature && { temperature: p.temperature }),
        ...(!hasTemperature && hasTopP && { top_p: p.top_p }),
        ...(p.stop && { stop_sequences: Array.isArray(p.stop) ? p.stop : [p.stop] }),
      };

      // ── Tools: add cache_control to the last tool so the full tool list ───
      // is cached as a unit (tools rarely change between turns).
      if (Array.isArray(p.tools) && p.tools.length > 0) {
        const convertedTools = oaiToolsToAnthropic(p.tools);
        convertedTools[convertedTools.length - 1] = {
          ...convertedTools[convertedTools.length - 1],
          cache_control: { type: "ephemeral" },
        };
        body.tools = convertedTools;
        const tc = oaiToolChoiceToAnthropic(p.tool_choice);
        if (tc) body.tool_choice = tc;
      }

      const up = await fetch(`${url}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });

      if (!up.ok) {
        const raw = await up.text().catch(() => up.statusText);
        let errBody: any;
        try { errBody = JSON.parse(raw); } catch { errBody = { error: raw }; }
        logger.warn({ status: up.status, model: p.model, errBody }, "Anthropic upstream error");
        res.status(up.status).json(errBody);
        return;
      }

      if (p.stream) return streamAnthropic(up.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>, res, p.model);
      res.json(anthropicToOaiResponse(await up.json() as any, p.model));
      return;
    }

    // ── Gemini ─────────────────────────────────────────────────────────────
    if (provider === "gemini") {
      const systemMsg = (p.messages || []).find((m: any) => m.role === "system");
      const geminiBody: any = {
        contents: oaiMessagesToGemini(p.messages || []),
        ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } }),
        generationConfig: {
          ...(p.temperature !== undefined && { temperature: p.temperature }),
          ...(p.max_tokens && { maxOutputTokens: p.max_tokens }),
        },
      };

      const endpoint = p.stream ? "streamGenerateContent" : "generateContent";
      const up = await fetch(`${url}/models/${p.model}:${endpoint}${p.stream ? "?alt=sse" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(geminiBody),
      });

      if (!up.ok) {
        const errBody = await up.json().catch(() => ({ error: up.statusText })) as any;
        logger.warn({ status: up.status, model: p.model, errBody }, "Gemini upstream error");
        res.status(up.status).json(errBody);
        return;
      }

      if (p.stream) return streamGemini(up.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>, res, p.model);
      res.json(geminiToOaiResponse(await up.json() as any, p.model));
      return;
    }

    res.status(400).json({ error: { message: `Unknown provider for model: ${p.model}`, type: "invalid_request_error" } });
  } catch (err) {
    logger.error({ err }, "Proxy error in chat completions");
    res.status(500).json({ error: { message: "Internal proxy error", type: "server_error" } });
  }
});

export default router;
