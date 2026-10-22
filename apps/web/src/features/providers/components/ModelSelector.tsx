"use client";
import type { AIStatus } from "../model/settings";
export function ModelSelector({
  status,
  onConfigure,
  onSelect,
}: {
  status: AIStatus;
  onConfigure: () => void;
  onSelect: (provider: string, model: string) => Promise<void>;
}) {
  return (
    <select
      aria-label="AI model"
      value={status.configured ? `${status.provider}:${status.model}` : ""}
      onChange={(e) => {
        if (e.target.value === "configure") onConfigure();
        else {
          const [provider, model] = e.target.value.split(":");
          void onSelect(provider, model);
        }
      }}
    >
      <option value="" disabled>
        {status.configured ? "Choose model" : "AI not configured"}
      </option>
      {status.configured && !status.models.includes(status.model) && (
        <option value={`${status.provider}:${status.model}`} disabled>
          {status.model} (unavailable)
        </option>
      )}
      {status.providers
        .filter((p) => p.configured)
        .map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models.map((m) => (
              <option key={m} value={`${p.id}:${m}`}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
      <option value="configure">Add / manage provider keys…</option>
    </select>
  );
}
