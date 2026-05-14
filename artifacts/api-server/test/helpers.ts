export type SilentLogger = {
  info: (bindings: unknown, message?: string) => void;
  warn: (bindings: unknown, message?: string) => void;
  error: (bindings: unknown, message?: string) => void;
  debug: (bindings: unknown, message?: string) => void;
  child: (bindings: Record<string, unknown>) => SilentLogger;
};

export function createSilentLogger(): SilentLogger {
  const logger: SilentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };

  return logger;
}

export async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
