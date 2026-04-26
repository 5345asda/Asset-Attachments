type JsonObject = Record<string, unknown>;

export type AnthropicStructuredOutputShim = {
  toolName: string;
};

type PrepareAnthropicStructuredOutputResult = {
  body: JsonObject;
  shim?: AnthropicStructuredOutputShim;
};

type StreamTransformState = {
  syntheticToolUseIndexes: Set<number>;
  rewroteAnyToolUse: boolean;
};

const STRUCTURED_OUTPUT_TOOL_NAME = "structured_output";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildToolText(input: unknown): string {
  return JSON.stringify(input) ?? "null";
}

function rewriteStructuredOutputToolUseBlock(
  block: unknown,
  shim: AnthropicStructuredOutputShim,
): Record<string, unknown> | undefined {
  if (!isRecord(block) || block.type !== "tool_use" || block.name !== shim.toolName) {
    return undefined;
  }

  return {
    type: "text",
    text: buildToolText(block.input),
  };
}

export function prepareAnthropicStructuredOutputRequest(
  body: JsonObject,
): PrepareAnthropicStructuredOutputResult {
  if (body.tools !== undefined || body.tool_choice !== undefined) {
    return { body };
  }

  if (!isRecord(body.output_config)) {
    return { body };
  }

  const outputConfig = { ...body.output_config };
  const format = outputConfig.format;

  if (!isRecord(format) || format.type !== "json_schema" || !isRecord(format.schema)) {
    return { body };
  }

  delete outputConfig.format;

  const nextBody: JsonObject = {
    ...body,
    tools: [
      {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        description: "Return the structured response as JSON.",
        input_schema: format.schema,
      },
    ],
    tool_choice: {
      type: "tool",
      name: STRUCTURED_OUTPUT_TOOL_NAME,
    },
  };

  if (outputConfig && Object.keys(outputConfig).length > 0) {
    nextBody.output_config = outputConfig;
  } else {
    delete nextBody.output_config;
  }

  return {
    body: nextBody,
    shim: {
      toolName: STRUCTURED_OUTPUT_TOOL_NAME,
    },
  };
}

export function restoreAnthropicStructuredOutputResponse(
  data: JsonObject,
  shim?: AnthropicStructuredOutputShim,
): JsonObject {
  if (!shim || !Array.isArray(data.content)) {
    return data;
  }

  let rewrote = false;
  const content = data.content.map((block) => {
    const rewritten = rewriteStructuredOutputToolUseBlock(block, shim);
    if (rewritten) {
      rewrote = true;
      return rewritten;
    }

    return block;
  });

  if (!rewrote) {
    return data;
  }

  return {
    ...data,
    content,
    stop_reason: data.stop_reason === "tool_use" ? "end_turn" : data.stop_reason,
  };
}

export function createAnthropicStructuredOutputEventTransformer(
  shim?: AnthropicStructuredOutputShim,
): (event: Record<string, unknown>) => Record<string, unknown> {
  const state: StreamTransformState = {
    syntheticToolUseIndexes: new Set<number>(),
    rewroteAnyToolUse: false,
  };

  return (event: Record<string, unknown>) => {
    if (!shim) {
      return event;
    }

    if (
      event.type === "content_block_start"
      && typeof event.index === "number"
      && isRecord(event.content_block)
      && event.content_block.type === "tool_use"
      && event.content_block.name === shim.toolName
    ) {
      state.syntheticToolUseIndexes.add(event.index);
      state.rewroteAnyToolUse = true;
      return {
        ...event,
        content_block: {
          type: "text",
          text: "",
        },
      };
    }

    if (
      event.type === "content_block_delta"
      && typeof event.index === "number"
      && state.syntheticToolUseIndexes.has(event.index)
      && isRecord(event.delta)
      && event.delta.type === "input_json_delta"
    ) {
      return {
        ...event,
        delta: {
          type: "text_delta",
          text: typeof event.delta.partial_json === "string" ? event.delta.partial_json : "",
        },
      };
    }

    if (
      event.type === "message_delta"
      && state.rewroteAnyToolUse
      && isRecord(event.delta)
      && event.delta.stop_reason === "tool_use"
    ) {
      return {
        ...event,
        delta: {
          ...event.delta,
          stop_reason: "end_turn",
        },
      };
    }

    return event;
  };
}
