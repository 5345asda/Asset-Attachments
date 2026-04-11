import { useState, useEffect } from "react";
import { Check, Copy, Eye, EyeOff, Zap, Server, Key, Code2, Globe, ChevronDown, ChevronUp } from "lucide-react";
import {
  getHealthzUrl,
  getAnthropicBaseUrl,
  getProxyInfoUrl,
} from "@/lib/runtime-config";

const MODELS = [
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
  const [baseUrl, setBaseUrl] = useState("");
  const [proxyKey, setProxyKey] = useState("");
  const [showCurl, setShowCurl] = useState(false);
  const [showToolCall, setShowToolCall] = useState(false);
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    const runtimeConfig = {
      locationOrigin: window.location.origin,
      overrideOrigin: apiOriginOverride,
    };
    const base = getAnthropicBaseUrl(runtimeConfig);

    setBaseUrl(base);

    fetch(getProxyInfoUrl(runtimeConfig))
      .then((r) => r.json())
      .then((d) => setProxyKey(d.proxyKey || ""))
      .catch(() => {});
  }, [apiOriginOverride]);

  useEffect(() => {
    if (!baseUrl) return;

    fetch(
      getHealthzUrl({
        locationOrigin: window.location.origin,
        overrideOrigin: apiOriginOverride,
      }),
    )
      .then((r) => setStatus(r.ok ? "online" : "offline"))
      .catch(() => setStatus("offline"));
  }, [apiOriginOverride, baseUrl]);

  const maskedKey = showKey ? proxyKey : (proxyKey ? proxyKey.slice(0, 10) + "••••••••••••••••••••" : "loading...");

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
              <h1 className="text-2xl font-bold tracking-tight">Anthropic Proxy</h1>
              <p className="text-sm text-muted-foreground">Only Anthropic native endpoints are exposed</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                status === "online"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : status === "offline"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  status === "online" ? "bg-emerald-400" : status === "offline" ? "bg-red-400" : "bg-yellow-400"
                }`} />
                {status === "checking" ? "Checking..." : status === "online" ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {/* Credentials Section */}
        <div className="grid gap-4 sm:grid-cols-2 mb-8">
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
            <span className="text-sm font-semibold text-foreground">Available Claude Models</span>
            <span className="ml-auto text-xs text-muted-foreground">{MODELS.length} models</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {MODELS.map((model) => (
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
                <span className="text-sm font-semibold">curl - Basic Message</span>
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
                <span className="text-sm font-semibold">curl - Tool Calling</span>
              </div>
              {showToolCall ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showToolCall && (
              <div className="mt-2">
                <CodeBlock code={toolCallExample} language="bash" id="curl-tools" />
              </div>
            )}
          </div>
        </div>

        {/* SDK example */}
        <div className="rounded-xl border border-card-border bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Code2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">JavaScript Fetch Example</span>
          </div>
          <CodeBlock code={fetchExample} language="TypeScript" id="fetch-example" />
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-4 border-t border-white/5">
          <p>Anthropic native proxy · Powered by Replit AI Integrations</p>
        </div>
      </div>
    </div>
  );
}
