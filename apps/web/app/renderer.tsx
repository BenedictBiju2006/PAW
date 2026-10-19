"use client";
import { FormEvent, useEffect, useState } from "react";
import {
  Collection,
  DataRecord,
  Field,
  RecordData,
} from "../../../packages/core/schema";
import { api } from "../lib/api";

type Report = (message: string) => void;
export function DataView({
  workspaceId,
  collection,
  mode,
  field,
  report,
  onChange,
  readOnly = false,
}: {
  workspaceId: string;
  collection: Collection;
  mode: "table" | "list" | "chart";
  field?: string;
  report: Report;
  onChange?: () => void;
  readOnly?: boolean;
}) {
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [aggregation, setAggregation] = useState<{
    count: number;
    distinctValues: number;
    buckets: { value: unknown; count: number }[];
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState("asc");
  const [filter, setFilter] = useState("");
  const [value, setValue] = useState("");
  const [queryFilter, setQueryFilter] = useState({ filter: "", value: "" });
  const [editing, setEditing] = useState<DataRecord | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const limit = 25;
  const base = `workspaces/${workspaceId}/collections/${collection.id}`;
  useEffect(() => {
    let current = true;
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      direction,
    });
    if (sort) params.set("sort", sort);
    if (queryFilter.filter && queryFilter.value !== "") {
      params.set("filter", queryFilter.filter);
      params.set("value", queryFilter.value);
    }
    api<{ records: DataRecord[]; total: number }>(`${base}?${params}`)
      .then((result) => {
        if (current) {
          setRecords(result.records);
          setTotal(result.total);
        }
      })
      .catch((e) => {
        if (current) report(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [base, offset, sort, direction, queryFilter, epoch, report]);
  async function remove(record: DataRecord) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    setBusy(true);
    try {
      await api(`${base}/${record.id}`, "DELETE", { confirmed: true });
      if (records.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - limit));
      else setEpoch((n) => n + 1);
      onChange?.();
    } catch (error) {
      report((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (mode !== "chart" || !field) return;
    let current = true;
    api(`${base}/aggregate?${new URLSearchParams({ field })}`)
      .then((result) => {
        if (current) setAggregation(result);
      })
      .catch((e) => current && report(e.message));
    return () => {
      current = false;
    };
  }, [base, mode, field, epoch, report]);
  return (
    <div className="data-view">
      <div className="data-toolbar">
        {mode !== "chart" && (
          <>
            <form
              className="filter-form"
              onSubmit={(e) => {
                e.preventDefault();
                setQueryFilter({ filter, value });
                setOffset(0);
              }}
            >
              <select
                aria-label="Filter field"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">Filter by…</option>
                {collection.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Exact filter value"
                placeholder="Exact value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <button disabled={loading}>Apply</button>
              <button
                type="button"
                onClick={() => {
                  setFilter("");
                  setValue("");
                  setQueryFilter({ filter: "", value: "" });
                  setOffset(0);
                }}
              >
                Clear
              </button>
            </form>
          </>
        )}
        <button
          className="primary"
          disabled={readOnly}
          onClick={() => setEditing("new")}
        >
          + Add record
        </button>
      </div>
      {mode !== "chart" && (
        <div className="row sort-controls">
          <label>
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Created date</option>
              {collection.fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                setOffset(0);
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
      )}
      {loading ? (
        <p role="status">Loading records…</p>
      ) : !records.length ? (
        <div className="no-records">
          <h3>
            {queryFilter.filter ? "No matching records." : "No records yet"}
          </h3>
          <p>
            {queryFilter.filter
              ? "Try a different filter."
              : "Add your first record to bring this collection to life."}
          </p>
        </div>
      ) : mode === "chart" ? (
        <div
          className="chart"
          role="img"
          aria-label={`Value counts for ${field} across all records`}
        >
          <p className="muted">
            Counts across all {aggregation?.count ?? 0} records · up to 100
            distinct values
          </p>
          {aggregation?.buckets.map(({ value, count }, i) => (
            <div key={i} className="chart-row">
              <span>{display(value)}</span>
              <div
                style={{
                  width: `${(100 * count) / Math.max(aggregation.count, 1)}%`,
                }}
              />
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      ) : mode === "list" ? (
        <div className="record-cards">
          {records.map((r) => (
            <article key={r.id}>
              {collection.fields.map((f) => (
                <p key={f.key}>
                  <span className="muted">{f.label}</span>
                  <br />
                  {display(r.data[f.key])}
                </p>
              ))}
              <div className="row">
                <button disabled={readOnly} onClick={() => setEditing(r)}>
                  Edit
                </button>
                <button
                  disabled={busy || readOnly}
                  className="danger-text"
                  onClick={() => remove(r)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {collection.fields.map((f) => (
                  <th key={f.key} scope="col">
                    {f.label}
                  </th>
                ))}
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  {collection.fields.map((f) => (
                    <td key={f.key}>{display(r.data[f.key])}</td>
                  ))}
                  <td>
                    <div className="row">
                      <button disabled={readOnly} onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button
                        disabled={busy || readOnly}
                        className="danger-text"
                        onClick={() => remove(r)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode !== "chart" && (
        <div className="pagination">
          <span>
            {total
              ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total} records`
              : "0 records"}
          </span>
          <div className="row">
            <button
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ← Previous
            </button>
            <button
              disabled={offset + limit >= total || loading}
              onClick={() => setOffset(offset + limit)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editing === "new" ? "Add record" : "Edit record"}
          >
            <button
              className="modal-close icon"
              aria-label="Close"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
            <h2>{editing === "new" ? "Add record" : "Edit record"}</h2>
            <RecordForm
              collection={collection}
              initial={editing === "new" ? undefined : editing.data}
              report={report}
              save={async (data) => {
                await api(
                  `${base}${editing === "new" ? "" : `/${editing.id}`}`,
                  editing === "new" ? "POST" : "PATCH",
                  {
                    data,
                    updatedAt:
                      editing === "new" ? undefined : editing.updated_at,
                  },
                );
                setEditing(null);
                setEpoch((n) => n + 1);
                onChange?.();
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
function display(value: unknown) {
  return value === null || value === undefined
    ? "—"
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : String(value);
}
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
