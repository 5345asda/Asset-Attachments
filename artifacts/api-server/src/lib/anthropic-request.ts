import { createHash } from "node:crypto";
import { ApiError } from "./api-error";
import { logger } from "./logger";

export const ANTHROPIC_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
];

const now = new Date().toISOString();

export const anthropicModelList = {
  data: ANTHROPIC_MODELS.map((id) => ({
    type: "model",
    id,
    display_name: id,
    created_at: now,
  })),
};

type JsonObject = Record<string, unknown>;
type Message = {
  role?: unknown;
  content?: unknown;
};

// Strip unsupported `scope` field from a cache_control object.
function stripCacheControlScope(cacheControl: unknown): unknown {
  if (cacheControl && typeof cacheControl === "object" && "scope" in cacheControl) {
    const { scope, ...rest } = cacheControl as Record<string, unknown>;
    logger.warn({ scope }, "Anthropic: removed unsupported cache_control.scope field");
    return rest;
  }

  return cacheControl;
}

function stripAllCacheControlScopes(body: JsonObject): JsonObject {
  let changed = false;
  const result = { ...body };

  if (Array.isArray(result.system)) {
    result.system = result.system.map((block: any) => {
      if (!block?.cache_control) {
        return block;
      }

      const nextCacheControl = stripCacheControlScope(block.cache_control);
      if (nextCacheControl !== block.cache_control) {
        changed = true;
        return { ...block, cache_control: nextCacheControl };
      }

      return block;
    });
  }

  if (Array.isArray(result.messages)) {
    result.messages = result.messages.map((message: any) => {
      if (!Array.isArray(message?.content)) {
        return message;
      }

      const content = message.content.map((block: any) => {
        if (!block?.cache_control) {
          return block;
        }

        const nextCacheControl = stripCacheControlScope(block.cache_control);
        if (nextCacheControl !== block.cache_control) {
          changed = true;
          return { ...block, cache_control: nextCacheControl };
        }

        return block;
      });

      return { ...message, content };
    });
  }

  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map((tool: any) => {
      if (!tool?.cache_control) {
        return tool;
      }

      const nextCacheControl = stripCacheControlScope(tool.cache_control);
      if (nextCacheControl !== tool.cache_control) {
        changed = true;
        return { ...tool, cache_control: nextCacheControl };
      }

      return tool;
    });
  }

  if (changed) {
    logger.warn({ model: result.model }, "Anthropic: stripped cache_control.scope from request body");
  }

  return result;
}

function countCacheControls(body: JsonObject): number {
  let count = 0;

  if (Array.isArray(body.system)) {
    for (const block of body.system as any[]) {
      if (block?.cache_control) {
        count += 1;
      }
    }
  }

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools as any[]) {
      if (tool?.cache_control) {
        count += 1;
      }
    }
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages as any[]) {
      if (!Array.isArray(message?.content)) {
        continue;
      }

      for (const block of message.content) {
        if ((block as any)?.cache_control) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function injectCacheControl(body: JsonObject): JsonObject {
  if (countCacheControls(body) > 0) {
    return body;
  }

  const result = { ...body };

  if (Array.isArray(result.tools) && result.tools.length > 0) {
    const tools = [...result.tools];
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    result.tools = tools;
  }

  if (result.system !== undefined) {
    let systemBlocks: any[];

    if (typeof result.system === "string") {
      systemBlocks = [{ type: "text", text: result.system }];
    } else if (Array.isArray(result.system)) {
      systemBlocks = [...result.system];
    } else {
      systemBlocks = [];
    }

    if (systemBlocks.length > 0) {
      systemBlocks[systemBlocks.length - 1] = {
        ...systemBlocks[systemBlocks.length - 1],
        cache_control: { type: "ephemeral", ttl: "1h" },
      };
      result.system = systemBlocks;
    }
  }

  if (Array.isArray(result.messages) && result.messages.length > 1) {
    const messages = [...result.messages];
    const target = { ...messages[messages.length - 2] };

    if (Array.isArray(target.content) && target.content.length > 0) {
      const content = [...target.content];
      content[content.length - 1] = {
        ...content[content.length - 1],
        cache_control: { type: "ephemeral", ttl: "1h" },
      };
      target.content = content;
      messages[messages.length - 2] = target;
      result.messages = messages;
    } else if (typeof target.content === "string") {
      target.content = [{
        type: "text",
        text: target.content,
        cache_control: { type: "ephemeral", ttl: "1h" },
      }];
      messages[messages.length - 2] = target;
      result.messages = messages;
    }
  }

  return result;
}

function enforceCacheControlLimit(body: JsonObject, limit: number): JsonObject {
  const total = countCacheControls(body);
  if (total <= limit) {
    return body;
  }

  let toRemove = total - limit;
  const result = { ...body };

  logger.warn(
    { model: result.model, total, limit },
    `Anthropic: trimming cache_control breakpoints from ${total} to ${limit}`,
  );

  function removeFromArray(
    items: any[],
    hasCacheControl: (item: any) => boolean,
    stripCacheControl: (item: any) => any,
    preserveLastWithCacheControl: boolean,
  ): any[] {
    if (toRemove <= 0) {
      return items;
    }

    const output = [...items];
    const lastCacheIndex = preserveLastWithCacheControl
      ? output.reduce((last, item, index) => (hasCacheControl(item) ? index : last), -1)
      : -1;

    for (let index = 0; index < output.length && toRemove > 0; index += 1) {
      if (hasCacheControl(output[index]) && index !== lastCacheIndex) {
        output[index] = stripCacheControl(output[index]);
        toRemove -= 1;
      }
    }

    return output;
  }

  if (toRemove > 0 && Array.isArray(result.system)) {
    result.system = removeFromArray(
      result.system as any[],
      (block) => !!block?.cache_control,
      (block) => {
        const { cache_control, ...rest } = block;
        return rest;
      },
      true,
    );
  }

  if (toRemove > 0 && Array.isArray(result.tools)) {
    result.tools = removeFromArray(
      result.tools as any[],
      (tool) => !!tool?.cache_control,
      (tool) => {
        const { cache_control, ...rest } = tool;
        return rest;
      },
      true,
    );
  }

  if (toRemove > 0 && Array.isArray(result.messages)) {
    const messages = [...(result.messages as any[])];

    for (let messageIndex = 0; messageIndex < messages.length && toRemove > 0; messageIndex += 1) {
      const message = messages[messageIndex];
      if (!Array.isArray(message?.content)) {
        continue;
      }

      const content = [...message.content];
      for (let contentIndex = 0; contentIndex < content.length && toRemove > 0; contentIndex += 1) {
        if (content[contentIndex]?.cache_control) {
          const { cache_control, ...rest } = content[contentIndex];
          content[contentIndex] = rest;
          toRemove -= 1;
        }
      }

      messages[messageIndex] = { ...message, content };
    }

    result.messages = messages;
  }

  if (toRemove > 0 && Array.isArray(result.system)) {
    result.system = removeFromArray(
      result.system as any[],
      (block) => !!block?.cache_control,
      (block) => {
        const { cache_control, ...rest } = block;
        return rest;
      },
      false,
    );
  }

  if (toRemove > 0 && Array.isArray(result.tools)) {
    result.tools = removeFromArray(
      result.tools as any[],
      (tool) => !!tool?.cache_control,
      (tool) => {
        const { cache_control, ...rest } = tool;
        return rest;
      },
      false,
    );
  }

  return result;
}

function normalizeCacheControlTTL(body: JsonObject): JsonObject {
  let seenDefault = false;
  let changed = false;
  const result = { ...body };

  function processItem(item: any, update: (next: any) => void): void {
    const cacheControl = item?.cache_control;
    if (!cacheControl) {
      return;
    }

    const isOneHour = typeof cacheControl === "object" && cacheControl.ttl === "1h";
    if (!isOneHour) {
      seenDefault = true;
    } else if (seenDefault) {
      const { ttl, ...rest } = cacheControl as Record<string, unknown>;
      update({ ...item, cache_control: rest });
      changed = true;
    }
  }

  if (Array.isArray(result.tools)) {
    const tools = [...(result.tools as any[])];
    for (let index = 0; index < tools.length; index += 1) {
      processItem(tools[index], (next) => {
        tools[index] = next;
      });
    }
    result.tools = tools;
  }

  if (Array.isArray(result.system)) {
    const systemBlocks = [...(result.system as any[])];
    for (let index = 0; index < systemBlocks.length; index += 1) {
      processItem(systemBlocks[index], (next) => {
        systemBlocks[index] = next;
      });
    }
    result.system = systemBlocks;
  }

  if (Array.isArray(result.messages)) {
    const messages = [...(result.messages as any[])];
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const message = messages[messageIndex];
      if (!Array.isArray(message?.content)) {
        continue;
      }

      const content = [...message.content];
      for (let contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
        processItem(content[contentIndex], (next) => {
          content[contentIndex] = next;
        });
      }

      messages[messageIndex] = { ...message, content };
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

function upgradeCacheControlTo1h(body: JsonObject): JsonObject {
  function upgrade(cacheControl: unknown): unknown {
    if (!cacheControl || typeof cacheControl !== "object") {
      return cacheControl;
    }

    const cacheControlObject = cacheControl as Record<string, unknown>;
    if (cacheControlObject.type === "ephemeral" && !("ttl" in cacheControlObject)) {
      return { ...cacheControlObject, ttl: "1h" };
    }

    return cacheControl;
  }

  function upgradeBlock(block: any): any {
    if (!block?.cache_control) {
      return block;
    }

    const nextCacheControl = upgrade(block.cache_control);
    return nextCacheControl !== block.cache_control
      ? { ...block, cache_control: nextCacheControl }
      : block;
  }

  const result = { ...body };
  let changed = false;

  if (Array.isArray(result.system)) {
    const systemBlocks = (result.system as any[]).map(upgradeBlock);
    if (systemBlocks.some((block, index) => block !== (result.system as any[])[index])) {
      result.system = systemBlocks;
      changed = true;
    }
  }

  if (Array.isArray(result.tools)) {
    const tools = (result.tools as any[]).map(upgradeBlock);
    if (tools.some((tool, index) => tool !== (result.tools as any[])[index])) {
      result.tools = tools;
      changed = true;
    }
  }

  if (Array.isArray(result.messages)) {
    const messages = (result.messages as any[]).map((message: any) => {
      if (!Array.isArray(message?.content)) {
        return message;
      }

      const content = (message.content as any[]).map(upgradeBlock);
      return content.some((block, index) => block !== message.content[index])
        ? { ...message, content }
        : message;
    });

    if (messages.some((message, index) => message !== (result.messages as any[])[index])) {
      result.messages = messages;
      changed = true;
    }
  }

  if (changed) {
    logger.info({ model: result.model }, "Upgraded cache_control TTL: ephemeral (5min) → 1h");
  }

  return result;
}

function stripUnsignedThinkingBlocks(body: JsonObject): JsonObject {
  if (!Array.isArray(body.messages)) {
    return body;
  }

  let dropped = 0;

  const messages = (body.messages as any[]).map((message: any) => {
    if (!Array.isArray(message?.content)) {
      return message;
    }

    const filtered = message.content.filter((block: any) => {
      if (block?.type !== "thinking") {
        return true;
      }

      if (block.signature) {
        return true;
      }

      dropped += 1;
      return false;
    });

    return filtered.length !== message.content.length
      ? { ...message, content: filtered }
      : message;
  });

  if (dropped > 0) {
    logger.warn(
      { model: body.model, dropped },
      "Anthropic: dropped thinking block(s) without signature — client must echo signature from prior response",
    );
  }

  return dropped > 0 ? { ...body, messages } : body;
}

function buildSystemFingerprint(body: JsonObject): { sysHash: string; sysLen: number } {
  if (Array.isArray(body.system)) {
    const systemText = (body.system as any[]).map((block: any) => block?.text ?? "").join("");
    return {
      sysLen: systemText.length,
      sysHash: createHash("sha1").update(systemText).digest("hex").slice(0, 12),
    };
  }

  if (typeof body.system === "string") {
    return {
      sysLen: body.system.length,
      sysHash: createHash("sha1").update(body.system).digest("hex").slice(0, 12),
    };
  }

  return { sysHash: "none", sysLen: 0 };
}

export function validateAnthropicMessages(messages: unknown): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  const lastMessage = messages[messages.length - 1] as Message;
  if (lastMessage?.role === "assistant") {
    throw new ApiError({
      status: 400,
      message: "Anthropic models require the final conversation turn to be a user message; assistant prefill is not supported.",
      type: "invalid_request_error",
      code: "anthropic_final_message_must_be_user",
    });
  }
}

export function sanitizeAnthropicBody(body: JsonObject): JsonObject {
  let result = stripUnsignedThinkingBlocks(body);
  result = stripAllCacheControlScopes(result);

  if (result.temperature !== undefined && result.top_p !== undefined) {
    const { top_p, ...rest } = result;
    logger.warn(
      { temperature: result.temperature, top_p },
      "Anthropic: removed top_p — cannot specify both temperature and top_p; keeping temperature",
    );
    result = rest;
  }

  if (Array.isArray(result.tools) && result.tools.length === 0) {
    const { tools, ...rest } = result;
    logger.warn({}, "Anthropic: removed empty tools array — Anthropic rejects tools: []");
    result = rest;
  }

  const clientCacheControlCount = countCacheControls(result);
  const { sysHash, sysLen } = buildSystemFingerprint(result);

  result = injectCacheControl(result);
  result = upgradeCacheControlTo1h(result);
  result = enforceCacheControlLimit(result, 4);
  result = normalizeCacheControlTTL(result);

  const finalCacheControlCount = countCacheControls(result);
  logger.info(
    {
      model: result.model,
      clientHadCacheControl: clientCacheControlCount > 0,
      clientCCCount: clientCacheControlCount,
      finalCCCount: finalCacheControlCount,
      msgCount: Array.isArray(result.messages) ? result.messages.length : 0,
      sysHash,
      sysLen,
    },
    "Anthropic cache_control state",
  );

  return result;
}
