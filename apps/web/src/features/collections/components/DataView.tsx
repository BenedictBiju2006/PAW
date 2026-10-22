"use client";
import { api } from "../../../shared/http/api";
import { useRecords } from "../hooks/useRecords";
import { Collection } from "../model/schema";
import { RecordForm } from "./RecordForm";
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
  const controller = useRecords({
    workspaceId,
    collection,
    mode,
    field,
    report,
    onChange,
    readOnly,
  });
  const {
    records,
    total,
    aggregation,
    offset,
    setOffset,
    sort,
    setSort,
    direction,
    setDirection,
    filter,
    setFilter,
    value,
    setValue,
    queryFilter,
    setQueryFilter,
    editing,
    setEditing,
    busy,
    loading,
    setEpoch,
    limit,
    base,
    remove,
  } = controller;
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
                    <td key={f.key} data-label={f.label}>
                      {display(r.data[f.key])}
                    </td>
                  ))}
                  <td data-label="Actions">
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
