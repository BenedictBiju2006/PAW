"use client";
import { useEffect, useState } from "react";
import { api } from "../../../shared/http/api";
export type AIStatus = {
  providers: {
    id: string;
    name: string;
    configured: boolean;
    models: string[];
    model: string;
    tokenWarning: number;
    dashboard: string;
  }[];
  validation?: { level: "metadata"; inferenceVerified: false; notice: string };
  configured: boolean;
  encryptionReady: boolean;
  provider: string;
  model: string;
  models: string[];
  tokenWarning: number;
  usage: { input: number; output: number; cost: null; period: string };
  warning: boolean;
};
export default function AISettings({
  close,
  updated,
}: {
  close: () => void;
  updated: (status: AIStatus) => void;
}) {
  const [status, setStatus] = useState<AIStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(""),
    [provider, setProvider] = useState("openai"),
    [model, setModel] = useState(""),
    [warning, setWarning] = useState(100000),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    api<AIStatus>("ai-settings")
      .then((s) => {
        if (current) {
          setStatus(s);
          setProvider(s.provider);
          setModel(s.model);
          setWarning(s.tokenWarning);
        }
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI settings"
      >
        <button className="modal-close" onClick={close}>
          Close
        </button>
        <h2>AI settings</h2>
        <p>
          Free-tier availability and rate limits depend on your provider
          account. PAW does not control provider billing.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {status && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setBusy(true);
              try {
                const next = await api<AIStatus>("ai-settings", "PUT", {
                  provider,
                  ...(key ? { apiKey: key } : {}),
                  model,
                  tokenWarning: warning,
                });
                setStatus(next);
                updated(next);
                setNotice(
                  next.validation?.notice ??
                    "Model metadata checked and settings saved. Inference has not been tested.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setKey("");
                setBusy(false);
              }
            }}
          >
            <p>
              {status.providers.find((p) => p.id === provider)?.configured
                ? "Provider configured"
                : "No API key configured"}
            </p>
            {!status.encryptionReady && (
              <p role="alert">
                Credential persistence is disabled until the server encryption
                key is configured.
              </p>
            )}
            <label>
              Provider
              <select
                value={provider}
                disabled={busy}
                onChange={(e) => {
                  const p = status.providers.find(
                    (p) => p.id === e.target.value,
                  )!;
                  setProvider(p.id);
                  setModel(p.model);
                  setWarning(p.tokenWarning);
                  setKey("");
                  setNotice("");
                  setError("");
                }}
              >
                {status.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Validation checks model metadata without making a billable
              inference request. Metadata does not guarantee inference or
              project access. Tool support follows the server allowlist; quota
              and access are checked by the provider when you send a message.
              Leave the key blank to choose a replacement model with your saved
              key.
            </p>
            <p>
              <a
                href="https://aistudio.google.com/usage"
                target="_blank"
                rel="noreferrer"
              >
                Gemini usage
              </a>{" "}
              ·{" "}
              <a
                href="https://ai.google.dev/gemini-api/docs/rate-limits"
                target="_blank"
                rel="noreferrer"
              >
                Gemini limits
              </a>{" "}
              ·{" "}
              <a
                href="https://console.groq.com/usage"
                target="_blank"
                rel="noreferrer"
              >
                Groq usage
              </a>{" "}
              ·{" "}
              <a
                href="https://console.groq.com/docs/rate-limits"
                target="_blank"
                rel="noreferrer"
              >
                Groq limits
              </a>
            </p>
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  status.providers.find((p) => p.id === provider)?.configured
                    ? "Leave blank to validate the saved key"
                    : "Enter API key"
                }
                maxLength={500}
              />
            </label>
            <label>
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {model &&
                  !status.providers
                    .find((p) => p.id === provider)
                    ?.models.includes(model) && (
                    <option value={model} disabled>
                      {model} (unavailable — choose another)
                    </option>
                  )}
                {(
                  status.providers.find((p) => p.id === provider)?.models ?? []
                ).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              Soft token warning (30 days)
              <input
                type="number"
                min={1000}
                max={100000000}
                value={warning}
                onChange={(e) => setWarning(Number(e.target.value))}
              />
            </label>
            <p className="muted">
              {status.usage.period}: {status.usage.input.toLocaleString()} input
              / {status.usage.output.toLocaleString()} output tokens. Cost
              unknown. This warning does not enforce a provider billing cap.
            </p>
            {status.warning && (
              <p role="status">Your soft token warning has been reached.</p>
            )}
            <div className="row">
              <button
                disabled={busy || !status.encryptionReady}
                className="primary"
              >
                {busy ? "Validating…" : "Validate & save"}
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !status.providers.find((p) => p.id === provider)?.configured
                }
                onClick={async () => {
                  if (!confirm("Remove this provider’s saved API key?")) return;
                  setBusy(true);
                  setError("");
                  try {
                    await api("ai-settings", "DELETE", { provider });
                    const next = await api<AIStatus>("ai-settings");
                    setStatus(next);
                    updated(next);
                    setKey("");
                    setNotice("API key removed.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove key
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
