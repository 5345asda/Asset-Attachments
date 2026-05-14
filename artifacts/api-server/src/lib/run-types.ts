export type InternalRunEnvelope = {
  runId: string;
  provider: string;
  routePath: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  stream: boolean;
  createdAt: string;
};

export type InternalRunRecord = InternalRunEnvelope & {
  status: "accepted" | "cancel_requested";
  cancelRequestedAt?: string;
  cancelReason?: string;
};
