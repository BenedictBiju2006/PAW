"use client";
import {useState} from "react";
import type {Field} from "../model/schema";
export function CollectionDialog({
  error,
  busy,
  close,
  save,
}: {
  error: string;
  busy: boolean;
  close: () => void;
  save: (value: { name: string; fields: Field[] }) => void;
}) {
  const [fields, setFields] = useState<Field[]>([
    { key: "title", label: "Title", type: "string", required: true },
  ]);
  const update = (index: number, patch: Partial<Field>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <div className="modal-backdrop">
      <section
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Create collection"
      >
        <button className="modal-close icon" onClick={close} aria-label="Close">
          ×
        </button>
        <h2>Create collection</h2>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <p>
          Define your fields. Schemas stay fixed to protect existing records.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save({
              name: String(new FormData(e.currentTarget).get("name")),
              fields,
            });
          }}
        >
          <label>
            Collection name
            <input
              name="name"
              required
              maxLength={100}
              autoFocus
              placeholder="e.g. Reading list"
            />
          </label>
          <div className="field-builder">
            {fields.map((f, i) => (
              <div className="field-row" key={i}>
                <label>
                  Label
                  <input
                    value={f.label}
                    maxLength={100}
                    required
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  Field key
                  <input
                    value={f.key}
                    pattern="[A-Za-z][A-Za-z0-9_]{0,63}"
                    required
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={f.type}
                    onChange={(e) =>
                      update(i, {
                        type: e.target.value as Field["type"],
                        options:
                          e.target.value === "enum" ? ["Option 1"] : undefined,
                      })
                    }
                  >
                    {["string", "number", "boolean", "date", "enum"].map(
                      (t) => (
                        <option key={t}>{t}</option>
                      ),
                    )}
                  </select>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => update(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${f.label} field`}
                  disabled={fields.length === 1}
                  onClick={() =>
                    setFields(fields.filter((_, index) => i !== index))
                  }
                >
                  ×
                </button>
                {f.type === "enum" && (
                  <label className="enum-options">
                    Options (comma separated)
                    <input
                      required
                      value={f.options?.join(",")}
                      onChange={(e) =>
                        update(i, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim()),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              disabled={fields.length >= 30}
              onClick={() =>
                setFields([
                  ...fields,
                  {
                    key: `field${fields.length + 1}`,
                    label: "New field",
                    type: "string",
                    required: false,
                  },
                ])
              }
            >
              + Add field
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Creating…" : "Create collection"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}