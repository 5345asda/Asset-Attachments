type ActiveRunHandle = {
  runId: string;
  abortController: AbortController;
  cancelReason?: string;
};

class RunRegistry {
  private readonly activeRuns = new Map<string, ActiveRunHandle>();

  start(runId: string, abortController: AbortController): void {
    this.activeRuns.set(runId, {
      runId,
      abortController,
    });
  }

  finish(runId: string): void {
    this.activeRuns.delete(runId);
  }

  requestCancel(runId: string, reason?: string): boolean {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return false;
    }

    activeRun.cancelReason = reason?.trim() || undefined;
    activeRun.abortController.abort(activeRun.cancelReason ?? "cancel_requested");
    return true;
  }

  has(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  activeRunCount(): number {
    return this.activeRuns.size;
  }
}

export function createRunRegistry(): RunRegistry {
  return new RunRegistry();
}

const runRegistry = createRunRegistry();

export function getRunRegistry(): RunRegistry {
  return runRegistry;
}
