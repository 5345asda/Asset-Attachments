import type { Response } from "express";
import { rid, now } from "../utils";
import { applyBillingOai } from "../billing";

// ─── OAI messages → Anthropic messages ───────────────────────────────────────
export function oaiMessagesToAnthropic(messages: any[]): any[] {
  const result: any[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      const last = result[result.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const content: any[] = [];
      if (msg.content) {
        if (typeof msg.content === "string") {
          content.push({ type: "text", text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text" && typeof part.text === "string") {
              content.push({ type: "text", text: part.text });
            }
          }
        } else if (typeof msg.content === "object" && typeof msg.content.text === "string") {
          content.push({ type: "text", text: msg.content.text });
        }
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let inputArgs = {};
          try { inputArgs = JSON.parse(tc.function?.arguments || "{}"); } catch { inputArgs = {}; }
          content.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input: inputArgs });
        }
      }
      const textForFallback = typeof msg.content === "string" ? msg.content : "";
      result.push({
        role: "assistant",
        content: content.length > 0 ? content : [{ type: "text", text: textForFallback }],
      });
      continue;
    }

    // user message
    if (typeof msg.content === "string") {
      result.push({ role: "user", content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map((p: any) => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "image_url") {
          const rawUrl: string = p.image_url?.url || "";
          // data URL (e.g. "data:image/png;base64,xxxx") → Anthropic base64 source
          // Vertex AI does not support data: URLs — must convert to base64 format
          if (rawUrl.startsWith("data:")) {
            const semi = rawUrl.indexOf(";");
            const comma = rawUrl.indexOf(",");
            const mediaType = semi > 0 ? rawUrl.slice(5, semi) : "image/jpeg";
            const data = comma > 0 ? rawUrl.slice(comma + 1) : "";
            return { type: "image", source: { type: "base64", media_type: mediaType, data } };
          }
          return { type: "image", source: { type: "url", url: rawUrl } };
        }
        return { type: "text", text: JSON.stringify(p) };
      });
      result.push({ role: "user", content: parts });
    } else {
      result.push({ role: "user", content: String(msg.content || "") });
    }
  }

  return result;
}

// ─── OAI tools → Anthropic tools ─────────────────────────────────────────────
export function oaiToolsToAnthropic(tools: any[]): any[] {
  return tools.map((t) => ({
    name: t.function?.name || t.name,
    description: t.function?.description || t.description || "",
    input_schema: t.function?.parameters || t.input_schema || { type: "object", properties: {} },
  }));
}

// ─── OAI tool_choice → Anthropic tool_choice ─────────────────────────────────
export function oaiToolChoiceToAnthropic(toolChoice: any): any {
  if (!toolChoice) return undefined;
  if (toolChoice === "none") return { type: "auto" };
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    return { type: "tool", name: toolChoice.function?.name };
  }
  return { type: "auto" };
}

// ─── Anthropic response → OAI response ───────────────────────────────────────
export function anthropicToOaiResponse(d: any, model: string): any {
  const content = d.content || [];
  const textBlocks = content.filter((b: any) => b.type === "text");
  const toolUseBlocks = content.filter((b: any) => b.type === "tool_use");

  const message: any = {
    role: "assistant",
    content: textBlocks.map((b: any) => b.text).join("") || null,
  };

  if (toolUseBlocks.length > 0) {
    message.tool_calls = toolUseBlocks.map((b: any) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
    }));
    if (!textBlocks.length) message.content = null;
  }

  const finishReason =
    d.stop_reason === "tool_use" ? "tool_calls"
    : d.stop_reason === "end_turn" ? "stop"
    : d.stop_reason || "stop";

  const rawUsage: Record<string, number> = {
    prompt_tokens: d.usage?.input_tokens || 0,
    completion_tokens: d.usage?.output_tokens || 0,
    total_tokens: (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0),
  };
  if (d.usage?.cache_creation_input_tokens != null) rawUsage["cache_creation_input_tokens"] = d.usage.cache_creation_input_tokens;
  if (d.usage?.cache_read_input_tokens != null)     rawUsage["cache_read_input_tokens"]     = d.usage.cache_read_input_tokens;

  return {
    id: rid(),
    object: "chat.completion",
    created: now(),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
    usage: applyBillingOai(rawUsage),
  };
}

// ─── Anthropic SSE stream → OAI SSE stream ───────────────────────────────────
export async function streamAnthropic(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  model: string,
) {
  const dec = new TextDecoder();
  const id = rid();
  let buf = "";
  const toolCallMap: Record<number, { id: string; name: string; argsBuf: string }> = {};

  // Accumulated usage — filled from message_start (input) + message_delta (output)
  const usage: Record<string, number> = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });

  const send = (delta: any, finishReason: string | null = null, extraFields?: Record<string, unknown>) =>
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: now(), model, choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }], ...extraFields })}\n\n`);

  send({ role: "assistant", content: "" });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      let e: any;
      try { e = JSON.parse(raw); } catch { continue; }

      // ── Capture initial usage (includes cache stats) ───────────────────
      if (e.type === "message_start" && e.message?.usage) {
        const u = e.message.usage;
        usage["prompt_tokens"]    = u.input_tokens  || 0;
        usage["completion_tokens"] = u.output_tokens || 0;
        usage["total_tokens"]     = (u.input_tokens || 0) + (u.output_tokens || 0);
        if (u.cache_creation_input_tokens != null) usage["cache_creation_input_tokens"] = u.cache_creation_input_tokens;
        if (u.cache_read_input_tokens     != null) usage["cache_read_input_tokens"]     = u.cache_read_input_tokens;
        continue;
      }

      if (e.type === "content_block_start" && e.content_block?.type === "tool_use") {
        const idx = e.index ?? 0;
        toolCallMap[idx] = { id: e.content_block.id, name: e.content_block.name, argsBuf: "" };
        send({ tool_calls: [{ index: idx, id: e.content_block.id, type: "function", function: { name: e.content_block.name, arguments: "" } }] });
      } else if (e.type === "content_block_delta") {
        if (e.delta?.type === "text_delta" && e.delta?.text) {
          send({ content: e.delta.text });
        } else if (e.delta?.type === "input_json_delta" && e.delta?.partial_json !== undefined) {
          const idx = e.index ?? 0;
          if (toolCallMap[idx]) {
            toolCallMap[idx].argsBuf += e.delta.partial_json;
            send({ tool_calls: [{ index: idx, function: { arguments: e.delta.partial_json } }] });
          }
        }
      } else if (e.type === "message_delta") {
        const sr = e.delta?.stop_reason;
        // Update output token count from message_delta (more accurate final count)
        if (e.usage?.output_tokens != null) {
          usage["completion_tokens"] = e.usage.output_tokens;
          usage["total_tokens"] = usage["prompt_tokens"] + e.usage.output_tokens;
        }
        send({}, sr === "tool_use" ? "tool_calls" : sr === "end_turn" ? "stop" : sr || "stop", { usage: applyBillingOai(usage) });
      }
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
