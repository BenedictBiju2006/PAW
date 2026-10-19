"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
export type AIStatus = {
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
    [model, setModel] = useState(""),
    [warning, setWarning] = useState(100000),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let current = true;
    api<AIStatus>("ai-settings")
      .then((s) => {
        if (current) {
          setStatus(s);
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
          Use your own separately billed OpenAI API account. A ChatGPT
          subscription does not include API usage.
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
                  ...(key ? { apiKey: key } : {}),
                  model,
                  tokenWarning: warning,
                });
                setStatus(next);
                updated(next);
                setNotice("Key validated and settings saved.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setKey("");
                setBusy(false);
              }
            }}
          >
            <p>
              {status.configured
                ? "OpenAI configured"
                : "No API key configured"}
            </p>
            {!status.encryptionReady && (
              <p role="alert">
                Credential persistence is disabled until the server encryption
                key is configured.
              </p>
            )}
            <label>
              OpenAI API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  status.configured
                    ? "Leave blank to validate the saved key"
                    : "sk-…"
                }
                maxLength={500}
              />
            </label>
            <label>
              Model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {status.models.map((m) => (
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
              unknown. This warning does not enforce an OpenAI billing cap.
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
                disabled={busy || !status.configured}
                onClick={async () => {
                  if (!confirm("Remove your saved OpenAI API key?")) return;
                  setBusy(true);
                  setError("");
                  try {
                    await api("ai-settings", "DELETE", {});
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
