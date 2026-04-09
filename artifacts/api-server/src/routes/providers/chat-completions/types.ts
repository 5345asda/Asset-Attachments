import type { Response } from "express";
import type { Logger } from "pino";

export type ChatCompletionPayload = Record<string, any>;

export interface ChatCompletionForwarderContext {
  payload: ChatCompletionPayload;
  url: string;
  key: string;
  provider: string;
  requestLogger: Logger;
  res: Response;
}

export type ChatCompletionForwarder = (
  context: ChatCompletionForwarderContext,
) => Promise<void>;
