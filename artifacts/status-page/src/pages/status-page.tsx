import { useState, useEffect } from "react";
import { Check, Copy, Eye, EyeOff, Zap, Server, Key, Code2, Globe, ChevronDown, ChevronUp } from "lucide-react";
import {
  getApiOrigin,
  getAxonHubOrigin,
  getAxonHubSyncUrl,
  getHealthzUrl,
  getAnthropicBaseUrl,
  getGeminiBaseUrl,
  getProxyInfoUrl,
  getGatewayStatus,
} from "@/lib/runtime-config";

const CLAUDE_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-opus-4-1",
];

const GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  return { copied, copy };
}

function CopyButton({ text, id, className = "" }: { text: string; id: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(text, id)}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
        copied === id
          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          : "bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 border border-white/10"
      } ${className}`}
    >
      {copied === id ? (
        <>
          <Check className="w-3 h-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          Copy
        </>
      )}
    </button>
  );
}

function CodeBlock({ code, language = "bash", id }: { code: string; language?: string; id: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative group rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <span className="text-xs text-muted-foreground font-mono">{language}</span>
        <button
          onClick={() => copy(code, id)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all duration-200 ${
            copied === id
              ? "text-emerald-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {copied === id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied === id ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-sm font-mono text-foreground/90 overflow-x-auto bg-black/30 leading-relaxed whitespace-pre-wrap break-all">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function StatusPage() {
  const apiOriginOverride = import.meta.env.VITE_API_ORIGIN;
  const [showKey, setShowKey] = useState(false);
  const [showAxonHubToken, setShowAxonHubToken] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [proxyKey, setProxyKey] = useState("");
  const [axonhubToken, setAxonhubToken] = useState("");
  const [syncingAxonHub, setSyncingAxonHub] = useState(false);
  const [axonhubSyncError, setAxonhubSyncError] = useState("");
  const [axonhubSyncResult, setAxonhubSyncResult] = useState<null | {
    axonhubOrigin: string;
    mode: "created" | "updated";
    provider: "anthropic" | "gemini" | "openrouter";
    channel: {
      id: string;
      name: string;
      baseURL: string;
      status?: string | null;
    };
  }>(null);
  const [showCurl, setShowCurl] = useState(false);
  const [showToolCall, setShowToolCall] = useState(false);
  const [showGeminiCurl, setShowGeminiCurl] = useState(false);
  const [healthOk, setHealthOk] = useState(false);
  const [anthropicConfigured, setAnthropicConfigured] = useState<boolean | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [geminiBaseUrl, setGeminiBaseUrl] = useState("");
  const axonhubOrigin = getAxonHubOrigin();

  useEffect(() => {
    const runtimeConfig = {
      locationOrigin: window.location.origin,
      overrideOrigin: apiOriginOverride,
    };
    const anthropicBase = getAnthropicBaseUrl(runtimeConfig);
    const geminiBase = getGeminiBaseUrl(runtimeConfig);

    setBaseUrl(anthropicBase);
    setGeminiBaseUrl(geminiBase);

    fetch(getProxyInfoUrl(runtimeConfig))
      .then((r) => r.json())
      .then((d) => {
        setProxyKey(d.proxyKey || "");
        setAnthropicConfigured(d.integrations?.anthropic?.configured === true);
        setGeminiConfigured(d.integrations?.gemini?.configured === true);
      })
      .catch(() => {});
  }, [apiOriginOverride]);

  useEffect(() => {
    if (!baseUrl && !geminiBaseUrl) return;

    fetch(
      getHealthzUrl({
        locationOrigin: window.location.origin,
        overrideOrigin: apiOriginOverride,
      }),
    )
      .then((r) => setHealthOk(r.ok))
      .catch(() => setHealthOk(false));
  }, [apiOriginOverride, baseUrl]);

  const status = getGatewayStatus({
    healthOk,
    anthropicConfigured,
    geminiConfigured,
  });

  const maskedKey = showKey ? proxyKey : (proxyKey ? proxyKey.slice(0, 10) + "••••••••••••••••••••" : "loading...");
  const canSyncAxonHub = !!axonhubToken.trim() && !!proxyKey && !!baseUrl;

  const curlExample = `curl ${baseUrl}/v1/messages \\
  -H "x-api-key: ${proxyKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  const toolCallExample = `curl ${baseUrl}/v1/messages \\
  -H "x-api-key: ${proxyKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "What is 42 + 58?"}],
    "tools": [{
      "name": "calculate",
      "description": "Perform math calculations",
      "input_schema": {
        "type": "object",
        "properties": {
          "expression": {"type": "string", "description": "Math expression"}
        },
        "required": ["expression"]
      }
    }],
    "tool_choice": {"type": "auto"}
  }'`;

  const geminiCurlExample = `curl ${geminiBaseUrl}/v1beta/models/gemini-2.5-flash:generateContent \\
  -H "x-api-key: ${proxyKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{
      "role": "user",
      "parts": [{"text": "Hello!"}]
    }]
  }'`;

  const fetchExample = `const response = await fetch("${baseUrl}/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": "${proxyKey}",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

const data = await response.json();
console.log(data);`;

  const geminiFetchExample = `const response = await fetch("${geminiBaseUrl}/v1beta/models/gemini-2.5-flash:generateContent", {
  method: "POST",
  headers: {
    "x-api-key": "${proxyKey}",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    contents: [{
      role: "user",
      parts: [{ text: "Hello!" }],
    }],
  }),
});

const data = await response.json();
console.log(data);`;

  async function handleAxonHubSync() {
    if (!canSyncAxonHub) {
      return;
    }

    const runtimeConfig = {
      locationOrigin: window.location.origin,
      overrideOrigin: apiOriginOverride,
    };

    setSyncingAxonHub(true);
    setAxonhubSyncError("");
    setAxonhubSyncResult(null);

    try {
      const response = await fetch(getAxonHubSyncUrl(runtimeConfig), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: axonhubToken,
          projectOrigin: getApiOrigin(runtimeConfig),
        }),
      });

      const body = await response.json() as {
        mode?: "created" | "updated";
        provider?: "anthropic" | "gemini" | "openrouter";
        axonhubOrigin?: string;
        channel?: {
          id: string;
          name: string;
          baseURL: string;
          status?: string | null;
        };
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(body.error?.message || "Failed to sync channel to AxonHub");
      }

      if (!body.mode || !body.provider || !body.channel || !body.axonhubOrigin) {
        throw new Error("AxonHub sync response was incomplete");
      }

      setAxonhubSyncResult({
        mode: body.mode,
        provider: body.provider,
        channel: body.channel,
        axonhubOrigin: body.axonhubOrigin,
      });
    } catch (error) {
      setAxonhubSyncError(
        error instanceof Error ? error.message : "Failed to sync channel to AxonHub",
      );
    } finally {
      setSyncingAxonHub(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Gradient header glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="absolute -top-40 right-0 w-96 h-96 rounded-full bg-cyan-600/8 blur-3xl" />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">AI Proxy Gateway</h1>
              <p className="text-sm text-muted-foreground">Anthropic + Gemini native endpoints are exposed</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                status === "online"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : status === "setup_required"
                    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : status === "offline"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  status === "online"
                    ? "bg-emerald-400"
                    : status === "setup_required"
                      ? "bg-amber-300"
                      : status === "offline"
                        ? "bg-red-400"
                        : "bg-yellow-400"
                }`} />
                {status === "checking"
                  ? "Checking..."
                  : status === "online"
                    ? "Online"
                    : status === "setup_required"
                      ? "Setup Required"
                      : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {status === "setup_required" && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 mb-8">
            <p className="text-sm text-amber-100">
              当前项目还没有可用 provider。Anthropic 需要启用 Replit integration；Gemini 也需要启用 Replit integration。
            </p>
          </div>
        )}

        {/* Credentials Section */}
        <div className="grid gap-4 lg:grid-cols-3 mb-8">
          {/* Base URL */}
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Anthropic Base URL</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-cyan-400 bg-black/30 rounded-lg px-3 py-2 border border-white/8 truncate">
                {baseUrl || "Loading..."}
              </code>
              {baseUrl && <CopyButton text={baseUrl} id="base-url" />}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Use as the request prefix for Anthropic-compatible calls
            </p>
          </div>

          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Gemini Base URL</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-emerald-400 bg-black/30 rounded-lg px-3 py-2 border border-white/8 truncate">
                {geminiBaseUrl || "Loading..."}
              </code>
              {geminiBaseUrl && <CopyButton text={geminiBaseUrl} id="gemini-base-url" />}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Use as the request prefix for Gemini native REST calls
            </p>
            <p className="text-xs text-amber-200/90 mt-2">
              Gemini does not support <code className="text-xs bg-white/5 px-1 rounded">/openai/chat/completions</code>.
              Use <code className="text-xs bg-white/5 px-1 rounded">/v1beta/models/{`{model}`}:generateContent</code> or
              <code className="text-xs bg-white/5 px-1 rounded ml-1">:streamGenerateContent?alt=sse</code>.
            </p>
          </div>

          {/* API Key */}
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Key className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">API Key</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-purple-400 bg-black/30 rounded-lg px-3 py-2 border border-white/8 truncate">
                {maskedKey}
              </code>
              <button
                onClick={() => setShowKey(!showKey)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <CopyButton text={proxyKey} id="api-key" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Send as <code className="text-xs bg-white/5 px-1 rounded">x-api-key</code> or <code className="text-xs bg-white/5 px-1 rounded">Authorization: Bearer</code>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">AxonHub Sync</span>
            <span className="ml-auto text-xs text-muted-foreground">Dynamic archived-share routing</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">AxonHub URL</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-cyan-400 bg-black/30 rounded-lg px-3 py-2 border border-white/8 truncate">
                    {axonhubOrigin}
                  </code>
                  <CopyButton text={axonhubOrigin} id="axonhub-origin" />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">AxonHub Admin Token</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={showAxonHubToken ? "text" : "password"}
                    value={axonhubToken}
                    onChange={(event) => setAxonhubToken(event.target.value)}
                    placeholder="Paste AxonHub token here"
                    className="flex-1 text-xs font-mono text-foreground bg-black/30 rounded-lg px-3 py-2 border border-white/8 outline-none placeholder:text-muted-foreground/70 focus:border-cyan-500/40"
                  />
                  <button
                    onClick={() => setShowAxonHubToken(!showAxonHubToken)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
                    title={showAxonHubToken ? "Hide token" : "Show token"}
                  >
                    {showAxonHubToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  只手填 AxonHub token。Dynamic archived-share routing：系统会统计由当前仓库托管的 channel，先保证各 provider 至少保留 10 个 enabled channel；达到这个下限后，再比较每个 provider 的 archived 占比和当前 enabled 占比，优先补给 archived 占比更高、但 enabled 占比偏低的 provider。archived 越多代表历史使用越多，所以后续新增 channel 会更容易继续补到这个 provider；如果暂时还没有 archived 信号，就先补当前 enabled 数更少的 provider。
                </p>
              </div>

              <div className="rounded-lg bg-black/20 border border-white/5 p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Current sync rule:
                  <span className="text-foreground"> gemini</span> uses
                  <span className="text-foreground"> type=gemini</span>,
                  <span className="text-foreground"> baseURL={geminiBaseUrl || " /api/gemini"}</span>,
                  <span className="text-foreground"> defaultTestModel=gemini-2.5-flash</span>,
                  <span className="text-foreground"> supportedModels=gemini-3.1-pro-preview / gemini-3-flash-preview / gemini-3-pro-image-preview / gemini-2.5-pro / gemini-2.5-flash / gemini-2.5-flash-image</span>.
                  <span className="text-foreground"> openrouter</span> uses
                  <span className="text-foreground"> type=openrouter</span>,
                  <span className="text-foreground"> baseURL=/api/openrouter</span>,
                  <span className="text-foreground"> defaultTestModel=z-ai/glm-4.7</span>,
                  <span className="text-foreground"> supportedModels=moonshotai/kimi-k2.6 / moonshotai/kimi-k2.5 / qwen/qwen3.6-flash / qwen/qwen3.6-35b-a3b / qwen/qwen3.6-max-preview / z-ai/glm-5.1 / z-ai/glm-5v-turbo / z-ai/glm-5-turbo / z-ai/glm-5 / z-ai/glm-4.7-flash / z-ai/glm-4.7 / openai/gpt-5.4-nano / openai/gpt-5.4-pro / openai/gpt-4o / x-ai/grok-4.20-multi-agent / x-ai/grok-4.20 / deepseek/deepseek-v4-pro / deepseek/deepseek-v4-flash / deepseek/deepseek-v3.2 / deepseek/deepseek-v3.2-exp / deepseek/deepseek-r1 / deepseek/deepseek-r1-0528 / minimax/minimax-m2.7 / minimax/minimax-m2.5 / xiaomi/mimo-v2.5 / xiaomi/mimo-v2.5-pro</span>.
                  <span className="text-foreground"> anthropic</span> uses
                  <span className="text-foreground"> type=anthropic</span>,
                  <span className="text-foreground"> baseURL={baseUrl || " /api/anthropic"}</span>,
                  <span className="text-foreground"> defaultTestModel=claude-opus-4-5</span>,
                  <span className="text-foreground"> supportedModels=claude-opus-4-7 / claude-opus-4-6 / claude-opus-4-5 / claude-sonnet-4-6 / claude-sonnet-4-5 / claude-haiku-4-5 / claude-opus-4-1</span>.
                  All three paths are synced back with
                  <span className="text-foreground"> status=enabled</span>,
                  <span className="text-foreground"> settings.passThroughUserAgent=inherit</span>, and
                  <span className="text-foreground"> settings.passThroughBody=false</span>.
                </p>
              </div>
            </div>

            <button
              onClick={handleAxonHubSync}
              disabled={!canSyncAxonHub || syncingAxonHub}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/90 text-slate-950 font-semibold transition-all hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              {syncingAxonHub ? "Syncing..." : "Sync to AxonHub"}
            </button>
          </div>

          {axonhubSyncError && (
            <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {axonhubSyncError}
            </div>
          )}

          {axonhubSyncResult && (
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-3">
              <p className="text-xs font-medium text-emerald-200">
                AxonHub {axonhubSyncResult.provider} channel {axonhubSyncResult.mode === "created" ? "created" : "updated"} successfully.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Provider</span>
                  <p className="text-foreground font-mono mt-1 break-all">{axonhubSyncResult.provider}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Name</span>
                  <p className="text-foreground font-mono mt-1 break-all">{axonhubSyncResult.channel.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Base URL</span>
                  <p className="text-foreground font-mono mt-1 break-all">{axonhubSyncResult.channel.baseURL}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="text-foreground font-mono mt-1 break-all">{axonhubSyncResult.channel.status || "unknown"}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Server Info */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Supported Endpoints</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { method: "GET", path: "/v1/models", desc: "List available Claude models" },
              { method: "POST", path: "/v1/messages", desc: "Anthropic native messages API (streaming supported)" },
              { method: "GET", path: "/v1beta/models", desc: "List available Gemini models" },
              { method: "POST", path: "/v1beta/models/{model}:generateContent", desc: "Gemini native generateContent API" },
              { method: "GET", path: "/openai/v1/models", desc: "List available OpenAI models" },
              { method: "POST", path: "/openai/v1/chat/completions", desc: "OpenAI chat completions API" },
              { method: "POST", path: "/openai/v1/responses", desc: "OpenAI responses API" },
            ].map((ep) => (
              <div key={ep.path} className="flex items-start gap-3 p-3 rounded-lg bg-black/20 border border-white/5">
                <span className={`mt-0.5 shrink-0 text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
                  ep.method === "GET" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"
                }`}>
                  {ep.method}
                </span>
                <div>
                  <code className="text-xs font-mono text-foreground/80">{ep.path}</code>
                  <p className="text-xs text-muted-foreground mt-0.5">{ep.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Available Models */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Available Models</span>
            <span className="ml-auto text-xs text-muted-foreground">{CLAUDE_MODELS.length + GEMINI_MODELS.length} models</span>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Claude</p>
              <div className="flex flex-wrap gap-2">
                {CLAUDE_MODELS.map((model) => (
                  <div
                    key={model}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium text-orange-400 bg-orange-500/10 border-orange-500/20"
                  >
                    <span className="font-mono">{model}</span>
                    <CopyButton text={model} id={`model-${model}`} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Gemini</p>
              <div className="flex flex-wrap gap-2">
                {GEMINI_MODELS.map((model) => (
                  <div
                    key={model}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                  >
                    <span className="font-mono">{model}</span>
                    <CopyButton text={model} id={`model-${model}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <span className="text-sm font-semibold text-foreground block mb-4">Claude Tool Calling Support</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { icon: "*", label: "Native Anthropic request body", desc: "Use messages, max_tokens, tools, and tool_choice directly" },
              { icon: "*", label: "Prompt caching normalization", desc: "cache_control fields are cleaned up before the upstream call" },
              { icon: "*", label: "Usage adjustment", desc: "Anthropic usage fields keep the existing billing normalization" },
              { icon: "*", label: "Streaming passthrough", desc: "text/event-stream responses are proxied directly" },
            ].map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/15">
                <span className="text-purple-400 text-base mt-0.5">{f.icon}</span>
                <div>
                  <p className="text-xs font-medium text-foreground/90">{f.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* curl Examples */}
        <div className="space-y-4 mb-8">
          <div>
            <button
              onClick={() => setShowCurl(!showCurl)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-card-border bg-card hover:bg-white/5 transition-all group"
            >
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Anthropic curl - Basic Message</span>
              </div>
              {showCurl ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showCurl && (
              <div className="mt-2">
                <CodeBlock code={curlExample} language="bash" id="curl-basic" />
              </div>
            )}
          </div>

          <div>
            <button
              onClick={() => setShowToolCall(!showToolCall)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-card-border bg-card hover:bg-white/5 transition-all group"
            >
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Anthropic curl - Tool Calling</span>
              </div>
              {showToolCall ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showToolCall && (
              <div className="mt-2">
                <CodeBlock code={toolCallExample} language="bash" id="curl-tools" />
              </div>
            )}
          </div>

          <div>
            <button
              onClick={() => setShowGeminiCurl(!showGeminiCurl)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-card-border bg-card hover:bg-white/5 transition-all group"
            >
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Gemini curl - generateContent</span>
              </div>
              {showGeminiCurl ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showGeminiCurl && (
              <div className="mt-2">
                <CodeBlock code={geminiCurlExample} language="bash" id="curl-gemini" />
              </div>
            )}
          </div>
        </div>

        {/* SDK example */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">JavaScript Fetch Examples</span>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Anthropic</p>
              <CodeBlock code={fetchExample} language="TypeScript" id="fetch-example-anthropic" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Gemini Native</p>
              <CodeBlock code={geminiFetchExample} language="TypeScript" id="fetch-example-gemini" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-4 border-t border-white/5">
          <p>Anthropic + Gemini native proxy · Replit-ready deployment</p>
        </div>
      </div>
    </div>
  );
}
