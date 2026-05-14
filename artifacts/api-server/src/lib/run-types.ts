export const INTERNAL_RUN_PROVIDERS = [
  "anthropic",
  "gemini",
  "openai",
  "openrouter",
] as const;

export type InternalRunProvider = (typeof INTERNAL_RUN_PROVIDERS)[number];

export type InternalRunStatus =
  | "accepted"
  | "running"
  | "streaming"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type InternalRunEnvelope = {
  runId: string;
  provider: InternalRunProvider;
  routePath: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  stream: boolean;
  createdAt: string;
};

export type InternalRunMeta = InternalRunEnvelope & {
  status: InternalRunStatus;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelRequestedAt?: string;
  cancelReason?: string;
  errorCode?: string;
  errorMessage?: string;
};
