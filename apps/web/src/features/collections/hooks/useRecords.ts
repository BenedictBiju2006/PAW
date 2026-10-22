"use client";
import { useEffect, useState } from "react";
import { api } from "../../../shared/http/api";
import type { CollectionAggregation } from "../model/schema";
import { Collection, DataRecord } from "../model/schema";
type Report = (message: string) => void;
export function useRecords({
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
    api<CollectionAggregation>(
      `${base}/aggregate?${new URLSearchParams({ field })}`,
    )
      .then((result) => {
        if (current) setAggregation(result);
      })
      .catch((e) => current && report(e.message));
    return () => {
      current = false;
    };
  }, [base, mode, field, epoch, report]);

  return {
    records,
    setRecords,
    total,
    setTotal,
    aggregation,
    setAggregation,
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
    setBusy,
    loading,
    setLoading,
    epoch,
    setEpoch,
    limit,
    base,
    remove,
  };
}
