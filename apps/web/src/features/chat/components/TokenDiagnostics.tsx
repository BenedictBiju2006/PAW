"use client";
import { useEffect, useState } from "react";
import { api } from "../../../shared/http/api";
import type { ModelRequestDiagnostic } from "../../agent/public";
import type { TurnStatus } from "../client/sessions";
import type { Conversation } from "../model/schema";

const count = (value: number | null | undefined) =>
  value == null ? "Unknown" : value.toLocaleString();
export function RequestDiagnosticsTable({
  requests,
}: {
  requests: ModelRequestDiagnostic[];
}) {
  return (
    <div
      className="token-diagnostics-scroll"
      tabIndex={0}
      role="region"
      aria-label="Model request token usage"
    >
      <table>
        <caption>
          Provider-reported tokens and approximate context size per request
        </caption>
        <thead>
          <tr>
            <th>Request</th>
            <th>Input tokens</th>
            <th>Output tokens</th>
            <th>Cached input tokens</th>
            <th>Cumulative input / output</th>
            <th>System chars</th>
            <th>History chars</th>
            <th>Tool definition chars</th>
            <th>Accumulated exchange chars</th>
            <th>Sent exchange chars</th>
            <th>Exchanges compacted</th>
            <th>Chars saved</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((row) => (
            <tr key={row.request}>
              <th scope="row">
                {row.request} · {row.status}
              </th>
              <td>{count(row.inputTokens)}</td>
              <td>{count(row.outputTokens)}</td>
              <td>{count(row.cachedInputTokens)}</td>
              <td>
                {count(row.cumulativeInputTokens)} /{" "}
                {count(row.cumulativeOutputTokens)}
              </td>
              <td>{count(row.contextCharacters.system)}</td>
              <td>{count(row.contextCharacters.history)}</td>
              <td>{count(row.contextCharacters.tools)}</td>
              <td>
                {count(
                  row.compaction?.rawExchangeCharacters ??
                    row.contextCharacters.exchanges,
                )}
              </td>
              <td>
                {count(
                  row.compaction?.sentExchangeCharacters ??
                    row.contextCharacters.exchanges,
                )}
              </td>
              <td>{count(row.compaction?.exchangesCompacted)}</td>
              <td>{count(row.compaction?.charactersSaved)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function TokenDiagnostics({
  workspaceId,
  conversations,
}: {
  workspaceId: string;
  conversations: Conversation[];
}) {
  const [selected, setSelected] = useState("");
  const [turns, setTurns] = useState<TurnStatus[]>([]);
  const [error, setError] = useState("");
  const conversationId = conversations.some((c) => c.id === selected)
    ? selected
    : conversations[0]?.id;
  useEffect(() => {
    setTurns([]);
    setError("");
    if (!conversationId) return;
    let current = true;
    const load = async () => {
      try {
        const rows = await api<TurnStatus[]>(
          `workspaces/${workspaceId}/conversations/${conversationId}/turns`,
        );
        if (current) {
          setTurns(rows);
          setError("");
        }
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    };
    void load();
    const poll = setInterval(() => void load(), 3500);
    return () => {
      current = false;
      clearInterval(poll);
    };
  }, [workspaceId, conversationId]);
  return (
    <section className="token-diagnostics" aria-label="Token diagnostics">
      <h2>Token diagnostics</h2>
      <p className="muted">
        Tokens are reported by the provider. Character counts measure serialized
        PAW context, not tokens or the exact provider request. History is the
        context prepared at turn start. Accumulated exchanges measure original
        history; sent exchanges include compact receipts and working state.
        Savings are approximate characters, not tokens. Unknown usage is not
        zero. Cached counts may be unavailable on some requests.
      </p>
      <label>
        Conversation
        <select
          value={conversationId ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {!conversations.length && <option value="">No conversations</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!error && !turns.length && (
        <p className="muted">No agent turns to inspect.</p>
      )}
      {turns.map((turn) => (
        <details key={turn.id}>
          <summary>
            {turn.provider} / {turn.model} · {turn.status} ·{" "}
            {count(turn.input_tokens)} input / {count(turn.output_tokens)}{" "}
            output tokens
          </summary>
          <p className="muted">
            Turn {turn.id} · {turn.model_requests} model requests ·{" "}
            {turn.tool_calls} tool calls. Totals sum reported usage only.
          </p>
          {turn.request_diagnostics?.length ? (
            <RequestDiagnosticsTable requests={turn.request_diagnostics} />
          ) : (
            <p className="muted">
              Per-request diagnostics are unavailable for this turn. Earlier
              turns retain their original totals.
            </p>
          )}
        </details>
      ))}
    </section>
  );
}
