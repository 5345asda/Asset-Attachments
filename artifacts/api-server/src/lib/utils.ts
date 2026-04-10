import { randomBytes } from "node:crypto";
import type { Response } from "express";

export const rid = () => "chatcmpl-" + randomBytes(4).toString("hex");
export const now = () => Math.floor(Date.now() / 1000);

export function getProviderCreds(provider: string): { url: string; key: string } {
  const P = provider.toUpperCase();
  const url = process.env[`AI_INTEGRATIONS_${P}_BASE_URL`] || "";
  const key = process.env[`AI_INTEGRATIONS_${P}_API_KEY`] || "";
  return { url, key };
}

export function getProviderIntegrationStatus() {
  return {
    anthropic: isProviderConfigured("anthropic"),
    openai: isProviderConfigured("openai"),
    gemini: isProviderConfigured("gemini"),
  };
}

function isProviderConfigured(provider: string): boolean {
  const { url, key } = getProviderCreds(provider);
  return !!url && !!key;
}

export function routeModel(model: string): string {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.includes("/")) return "openrouter";
  return "openai";
}

export async function pipeStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
) {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}
