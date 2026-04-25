import { createHash } from "node:crypto";
import { logger } from "./logger";

export const ANTHROPIC_MODELS = [
  "claude-opus-4-7",
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

const CLAUDE_OPUS_4_7 = "claude-opus-4-7";
const TEMPERATURE_DEPRECATED_MODELS = new Set(["claude-opus-4-7"]);
const STRICT_SAMPLING_DISABLED_MODELS = new Set(["claude-opus-4-7"]);

const now = new Date().toISOString();

const anthropicModels = ANTHROPIC_MODELS.map((id) => ({
  type: "model",
  id,
  display_name: id,
  created_at: now,
}));

export const anthropicModelList = {
  data: anthropicModels,
  first_id: anthropicModels[0]?.id ?? null,
  last_id: anthropicModels[anthropicModels.length - 1]?.id ?? null,
  has_more: false,
};

type JsonObject = Record<string, unknown>;
type Message = {
  role?: unknown;
  content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isClaudeOpus47(model: unknown): boolean {
  return model === CLAUDE_OPUS_4_7;
}

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

function dropUnexpectedToolResults(body: JsonObject): JsonObject {
  if (!Array.isArray(body.messages)) {
    return body;
  }

  let dropped = 0;
  const droppedToolUseIds = new Set<string>();
  const sourceMessages = body.messages as any[];

  const messages = sourceMessages.map((message: any, index: number) => {
    if (message?.role !== "user" || !Array.isArray(message?.content)) {
      return message;
    }

    const previousMessage = index > 0 ? sourceMessages[index - 1] : undefined;
    const validToolUseIds = new Set<string>();

    if (previousMessage?.role === "assistant" && Array.isArray(previousMessage?.content)) {
      for (const block of previousMessage.content) {
        if (block?.type === "tool_use" && typeof block.id === "string") {
          validToolUseIds.add(block.id);
        }
      }
    }

    const filtered = message.content.filter((block: any) => {
      if (block?.type !== "tool_result") {
        return true;
      }

      if (typeof block.tool_use_id !== "string" || !validToolUseIds.has(block.tool_use_id)) {
        dropped += 1;
        if (typeof block.tool_use_id === "string") {
          droppedToolUseIds.add(block.tool_use_id);
        }
        return false;
      }

      return true;
    });

    return filtered.length !== message.content.length
      ? { ...message, content: filtered }
      : message;
  });

  if (dropped > 0) {
    logger.warn(
      {
        model: body.model,
        dropped,
        toolUseIds: [...droppedToolUseIds],
      },
      "Anthropic: dropped tool_result block(s) without a matching tool_use in the previous assistant message",
    );
  }

  return dropped > 0 ? { ...body, messages } : body;
}

function migrateDeprecatedOutputFormat(body: JsonObject): JsonObject {
  if (body.output_format === undefined) {
    return body;
  }

  const outputConfig = isRecord(body.output_config) ? { ...body.output_config } : {};
  const { output_format, ...rest } = body;

  if (outputConfig.format === undefined) {
    outputConfig.format = output_format;
  }

  logger.warn({ model: body.model }, "Anthropic: migrated deprecated output_format to output_config.format");
  return {
    ...rest,
    output_config: outputConfig,
  };
}

function migrateClaudeOpus47Thinking(body: JsonObject): JsonObject {
  if (!isClaudeOpus47(body.model) || !isRecord(body.thinking)) {
    return body;
  }

  const thinking = body.thinking;
  const hasLegacyShape =
    thinking.type === "enabled"
    || "budget_tokens" in thinking
    || "enabled" in thinking;

  if (!hasLegacyShape) {
    return body;
  }

  const result: JsonObject = { ...body };
  const outputConfig = isRecord(body.output_config) ? { ...body.output_config } : {};
  const display = typeof thinking.display === "string" ? thinking.display : undefined;

  if (thinking.enabled === false || thinking.type === "disabled") {
    delete result.thinking;
    logger.warn(
      { model: body.model },
      "Anthropic: removed disabled legacy thinking config for Claude Opus 4.7",
    );
    return result;
  }

  result.thinking = display ? { type: "adaptive", display } : { type: "adaptive" };

  if (outputConfig.effort === undefined) {
    outputConfig.effort = "high";
  }

  if (Object.keys(outputConfig).length > 0) {
    result.output_config = outputConfig;
  }

  logger.warn(
    { model: body.model },
    "Anthropic: migrated legacy Claude Opus 4.7 thinking config to adaptive thinking",
  );
  return result;
}

function stripUnsupportedSamplingParameters(body: JsonObject): JsonObject {
  if (typeof body.model !== "string" || !STRICT_SAMPLING_DISABLED_MODELS.has(body.model)) {
    return body;
  }

  let changed = false;
  const result = { ...body };

  for (const key of ["temperature", "top_p", "top_k"] as const) {
    if (result[key] !== undefined) {
      delete result[key];
      changed = true;
    }
  }

  if (changed) {
    logger.warn(
      { model: body.model },
      "Anthropic: removed sampling parameters that are unsupported for this model",
    );
  }

  return changed ? result : body;
}

function hasEnabledThinking(body: JsonObject): boolean {
  const thinking = body.thinking;

  if (thinking === undefined || thinking === null || thinking === false) {
    return false;
  }

  if (typeof thinking !== "object") {
    return true;
  }

  const thinkingConfig = thinking as Record<string, unknown>;
  if (thinkingConfig.enabled === false || thinkingConfig.type === "disabled") {
    return false;
  }

  return true;
}

function normalizeThinkingMaxTokens(body: JsonObject): JsonObject {
  if (!hasEnabledThinking(body) || !isRecord(body.thinking)) {
    return body;
  }

  const budgetTokens = body.thinking.budget_tokens;
  const maxTokens = body.max_tokens;

  if (
    typeof budgetTokens !== "number"
    || !Number.isFinite(budgetTokens)
    || typeof maxTokens !== "number"
    || !Number.isFinite(maxTokens)
    || maxTokens > budgetTokens
  ) {
    return body;
  }

  const normalizedMaxTokens = budgetTokens + maxTokens;
  logger.warn(
    {
      model: body.model,
      max_tokens: maxTokens,
      thinking_budget_tokens: budgetTokens,
      normalized_max_tokens: normalizedMaxTokens,
    },
    "Anthropic: raised max_tokens above thinking.budget_tokens to satisfy upstream validation",
  );

  return {
    ...body,
    max_tokens: normalizedMaxTokens,
  };
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

export function sanitizeAnthropicBody(body: JsonObject): JsonObject {
  let result = dropUnexpectedToolResults(body);
  result = stripUnsignedThinkingBlocks(result);
  result = migrateDeprecatedOutputFormat(result);
  result = migrateClaudeOpus47Thinking(result);
  result = stripAllCacheControlScopes(result);
  result = stripUnsupportedSamplingParameters(result);
  result = normalizeThinkingMaxTokens(result);

  if (
    typeof result.model === "string" &&
    TEMPERATURE_DEPRECATED_MODELS.has(result.model) &&
    result.temperature !== undefined
  ) {
    const { temperature, ...rest } = result;
    logger.warn(
      { temperature, model: result.model },
      "Anthropic: removed deprecated temperature for model",
    );
    result = rest;
  }

  if (hasEnabledThinking(result) && result.temperature !== undefined && result.temperature !== 1) {
    logger.warn(
      { temperature: result.temperature, model: result.model },
      "Anthropic: normalized temperature to 1 because thinking is enabled",
    );
    result = {
      ...result,
      temperature: 1,
    };
  }

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
