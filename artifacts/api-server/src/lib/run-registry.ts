import type { InternalRunEnvelope, InternalRunRecord } from "./run-types";

class RunRegistry {
  private readonly runs = new Map<string, InternalRunRecord>();

  accept(envelope: InternalRunEnvelope): InternalRunRecord {
    const record: InternalRunRecord = {
      ...envelope,
      status: "accepted",
    };

    this.runs.set(envelope.runId, record);
    return record;
  }

  requestCancel(runId: string, reason?: string): InternalRunRecord | null {
    const existing = this.runs.get(runId);
    if (!existing) {
      return null;
    }

    const nextRecord: InternalRunRecord = {
      ...existing,
      status: "cancel_requested",
      cancelRequestedAt: new Date().toISOString(),
      cancelReason: reason?.trim() || undefined,
    };

    this.runs.set(runId, nextRecord);
    return nextRecord;
  }

  activeRunCount(): number {
    return [...this.runs.values()].filter((record) => record.status === "accepted").length;
  }
}

const runRegistry = new RunRegistry();

export function getRunRegistry(): RunRegistry {
  return runRegistry;
}
