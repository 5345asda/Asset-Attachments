export const DEFAULT_PROXY_API_KEY = "sk-proxy-6f2d0c9a47b13e8d5f71a2c46be93d07f8c1a54e692db3fc";

// Keep the runtime key stable by default so restarts and container swaps do not rotate clients.
export const PROXY_API_KEY: string =
  process.env["PROXY_API_KEY"]?.trim() || DEFAULT_PROXY_API_KEY;
