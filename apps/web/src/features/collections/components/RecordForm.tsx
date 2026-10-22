"use client";
import { FormEvent, useState } from "react";
import { Collection, Field, RecordData } from "../model/schema";
type Report = (message: string) => void;
export function RecordForm({
  collection,
  initial,
  save,
  report,
}: {
  collection: Collection;
  initial?: RecordData;
  save: (data: RecordData) => Promise<void>;
  report: Report;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const data: RecordData = {};
    for (const field of collection.fields) {
      const raw = String(values.get(field.key) ?? "");
      data[field.key] =
        raw === "" && !field.required
          ? null
          : field.type === "number"
            ? Number(raw)
            : field.type === "boolean"
              ? raw === "true"
              : raw;
    }
    setBusy(true);
    setError("");
    try {
      await save(data);
      if (!initial) form.reset();
    } catch (error) {
      setError((error as Error).message);
      report((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="record-form" onSubmit={submit}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="record-fields">
        {collection.fields.map((field) => (
          <label key={field.key}>
            {field.label}
            {field.required && " *"}
            <FieldInput field={field} value={initial?.[field.key]} />
          </label>
        ))}
      </div>
      <button className="primary" disabled={busy}>
        {busy ? "Saving…" : initial ? "Save changes" : "Add record"}
      </button>
    </form>
  );
}
function FieldInput({
  field,
  value,
}: {
  field: Field;
  value?: RecordData[string];
}) {
  const props = {
    name: field.key,
    required: field.required,
    defaultValue: value === null || value === undefined ? "" : String(value),
  };
  if (field.type === "boolean")
    return (
      <select {...props}>
        <option value="">Choose…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (field.type === "enum")
    return (
      <select {...props}>
        <option value="">Choose…</option>
        {field.options?.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  return (
    <input
      {...props}
      type={
        field.type === "number"
          ? "number"
          : field.type === "date"
            ? "date"
            : "text"
      }
      step={field.type === "number" ? "any" : undefined}
      maxLength={field.type === "string" ? 10000 : undefined}
    />
  );
}
