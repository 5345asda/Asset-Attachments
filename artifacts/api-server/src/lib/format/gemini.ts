import type { Response } from "express";
import { rid, now } from "../utils";

// ─── OAI messages → Gemini contents ──────────────────────────────────────────
export function oaiMessagesToGemini(messages: any[]): any[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));
}

// ─── Gemini response → OAI response ──────────────────────────────────────────
export function geminiToOaiResponse(d: any, model: string): any {
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return {
    id: rid(),
    object: "chat.completion",
    created: now(),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
    usage: {
      prompt_tokens: d.usageMetadata?.promptTokenCount || 0,
      completion_tokens: d.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: d.usageMetadata?.totalTokenCount || 0,
    },
  };
}

// ─── Gemini SSE stream → OAI SSE stream ──────────────────────────────────────
export async function streamGemini(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  model: string,
) {
  const dec = new TextDecoder();
  const id = rid();
  let buf = "";

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const e = JSON.parse(line.slice(6));
        const t = e.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: now(), model, choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`);
        if (e.candidates?.[0]?.finishReason) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: now(), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      } catch { /* skip malformed SSE frames */ }
    }
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
