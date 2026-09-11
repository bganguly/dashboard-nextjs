"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendFilterParams, type OrderFilters } from "@/components/FilterSidebar";

export type SearchRow = Record<string, unknown>;

type SortDir = "asc" | "desc";

export interface SearchResponse {
  data: SearchRow[];
  page: number;
  totalPages: number;
  total: number;
  approximate?: boolean;
}

interface SearchTableProps {
  endpoint?: string;
  pageSize?: number;
  filters?: OrderFilters;
  onRows?: (rows: SearchRow[]) => void;
  onQueryChange?: (q: string) => void;
  externalTotal?: number | null;
  onRefinedCount?: (total: number) => void;
}

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function renderCustomer(row: SearchRow): string {
  const c = row.customer as { firstName?: string; lastName?: string; email?: string } | undefined;
  if (!c) return "";
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email || "";
}

function renderItems(row: SearchRow): string {
  return Array.isArray(row.items) ? String(row.items.length) : "";
}

function renderTotal(row: SearchRow): string {
  return typeof row.total === "number" ? moneyFmt.format(row.total) : formatCell(row.total);
}

function renderDate(row: SearchRow): string {
  const v = row.placedAt;
  if (typeof v !== "string") return formatCell(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

interface ColumnDef {
  key: string;
  label: string;
  numeric?: boolean;
  sortKey?: string;
  render: (row: SearchRow) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: "id",       label: "ID",       sortKey: "id",       render: (r) => formatCell(r.id) },
  { key: "customer", label: "Customer", sortKey: "customer", render: renderCustomer },
  { key: "items",    label: "Items",    numeric: true,        render: renderItems },
  { key: "total",    label: "Total",    numeric: true, sortKey: "total",    render: renderTotal },
  { key: "notes",    label: "Notes",                          render: (r) => formatCell(r.notes) },
  { key: "placedAt", label: "Placed",   sortKey: "placedAt", render: renderDate },
];

type PageItem = number | "left-ellipsis" | "right-ellipsis";

function getPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const sibling = 1;
  const left = Math.max(current - sibling, 1);
  const right = Math.min(current + sibling, total);
  const items: PageItem[] = [1];
  if (left > 2) items.push("left-ellipsis");
  for (let i = Math.max(left, 2); i <= Math.min(right, total - 1); i++) items.push(i);
  if (right < total - 1) items.push("right-ellipsis");
  items.push(total);
  return items;
}

export default function SearchTable({
  endpoint = "/api/orders",
  pageSize = 20,
  filters,
  onRows,
  onQueryChange,
  externalTotal,
  onRefinedCount,
}: SearchTableProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const displayTotal = typeof externalTotal === "number" ? externalTotal : total;
  const displayTotalPages = typeof externalTotal === "number"
    ? Math.max(1, Math.ceil(externalTotal / pageSize))
    : totalPages;

  const [sort, setSort] = useState<string>("placedAt");
  const [dir, setDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [warmingUp, setWarmingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const onRowsRef = useRef(onRows);
  useEffect(() => { onRowsRef.current = onRows; });

  const cursorAnchorRef = useRef<{
    page: number;
    firstId: unknown;
    firstPlacedAt: string;
    lastId: unknown;
    lastPlacedAt: string;
  } | null>(null);
  const skipNextFetchRef = useRef(false);

  const applyResponse = useCallback(
    (json: SearchResponse, p: number, sortCol: string, sortDir: SortDir) => {
      const data = Array.isArray(json.data) ? json.data : [];
      setRows(data);
      setTotalPages(Math.max(1, json.totalPages ?? 1));
      setTotal(json.total ?? 0);
      onRowsRef.current?.(data);
      if (sortCol === "placedAt" && sortDir === "desc" && data.length > 0) {
        const first = data[0] as { id?: unknown; placedAt?: unknown };
        const last = data[data.length - 1] as { id?: unknown; placedAt?: unknown };
        if (typeof first.placedAt === "string" && typeof last.placedAt === "string") {
          cursorAnchorRef.current = {
            page: p,
            firstId: first.id,
            firstPlacedAt: first.placedAt,
            lastId: last.id,
            lastPlacedAt: last.placedAt,
          };
        } else {
          cursorAnchorRef.current = null;
        }
      } else {
        cursorAnchorRef.current = null;
      }
    },
    [],
  );

  const fetchPage = useCallback(
    async (q: string, p: number, sortCol: string, sortDir: SortDir, f: OrderFilters | undefined, showSearchIndicator: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setSearchLoading(showSearchIndicator);
      setError(null);
      try {
        const params = new URLSearchParams({ q, page: String(p), pageSize: String(pageSize) });
        if (sortCol) { params.set("sort", sortCol); params.set("dir", sortDir); }
        appendFilterParams(params, f);
        const res = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SearchResponse = await res.json();
        applyResponse(json, p, sortCol, sortDir);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
        setRows([]); setTotalPages(1); setTotal(0);
        cursorAnchorRef.current = null;
      } finally {
        if (abortRef.current === controller) { setLoading(false); setSearchLoading(false); }
      }
    },
    [endpoint, pageSize, applyResponse],
  );

  const fetchAdjacentByCursor = useCallback(
    async (q: string, targetPage: number, f: OrderFilters | undefined, cursorId: unknown, cursorPlacedAt: string, direction: "next" | "prev") => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true); setSearchLoading(false); setError(null);
      try {
        const params = new URLSearchParams({
          q, page: String(targetPage), pageSize: String(pageSize),
          sort: "placedAt", dir: "desc",
          cursorId: String(cursorId), cursorPlacedAt, cursorDir: direction,
        });
        appendFilterParams(params, f);
        const res = await fetch(`${endpoint}?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: SearchResponse = await res.json();
        applyResponse(json, targetPage, "placedAt", "desc");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
        setRows([]); setTotalPages(1); setTotal(0);
        cursorAnchorRef.current = null;
      } finally {
        if (abortRef.current === controller) { setLoading(false); setSearchLoading(false); }
      }
    },
    [endpoint, pageSize, applyResponse],
  );

  useEffect(() => { onQueryChange?.(debouncedQuery); }, [debouncedQuery, onQueryChange]);

  const lastFiltersKey = useRef<string>(JSON.stringify(filters ?? {}));
  const lastFetchedQuery = useRef(debouncedQuery);
  useEffect(() => {
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    const key = JSON.stringify(filters ?? {});
    if (key !== lastFiltersKey.current) {
      lastFiltersKey.current = key;
      if (page !== 1) { setPage(1); return; }
    }
    const queryChanged = debouncedQuery !== lastFetchedQuery.current;
    lastFetchedQuery.current = debouncedQuery;
    fetchPage(debouncedQuery, page, sort, dir, filters, queryChanged);
  }, [debouncedQuery, page, pageSize, sort, dir, filters, fetchPage]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  useEffect(() => {
    if (!loading) { setWarmingUp(false); return; }
    const t = setTimeout(() => setWarmingUp(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  const toggleSort = useCallback((sortKey: string) => {
    if (sort === sortKey) { setDir((d) => (d === "asc" ? "desc" : "asc")); }
    else { setSort(sortKey); setDir("asc"); }
    setPage(1);
  }, [sort]);

  const goToPage = useCallback((n: number) => {
    setPage(Math.min(Math.max(n, 1), displayTotalPages));
  }, [displayTotalPages]);

  const goToAdjacentPage = useCallback((direction: "prev" | "next") => {
    const targetPage = direction === "next" ? page + 1 : page - 1;
    const clamped = Math.min(Math.max(targetPage, 1), displayTotalPages);
    if (clamped === page) return;
    const anchor = cursorAnchorRef.current;
    if (anchor && anchor.page === page) {
      const cursorId = direction === "next" ? anchor.lastId : anchor.firstId;
      const cursorPlacedAt = direction === "next" ? anchor.lastPlacedAt : anchor.firstPlacedAt;
      if (cursorId != null) {
        skipNextFetchRef.current = true;
        setPage(clamped);
        fetchAdjacentByCursor(debouncedQuery, clamped, filters, cursorId, cursorPlacedAt, direction);
        return;
      }
    }
    goToPage(clamped);
  }, [page, displayTotalPages, debouncedQuery, filters, fetchAdjacentByCursor, goToPage]);

  const pageItems = useMemo(() => getPageItems(page, displayTotalPages), [page, displayTotalPages]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">Search orders</h2>
        {loading && (
          <span className="text-xs text-indigo-500" aria-live="polite">
            {searchLoading ? "searching…" : "updating…"}
          </span>
        )}
      </div>

      <div className="relative mb-4">
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          data-testid="search-input"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value === "") { setDebouncedQuery(""); setPage(1); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { setDebouncedQuery(query); setPage(1); }
          }}
          placeholder="Search records…"
          className="w-full rounded-full border border-gray-300 bg-white py-3 pl-11 pr-4 text-base text-gray-900 shadow-sm outline-none placeholder:text-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          aria-label="Search records"
        />
      </div>

      {debouncedQuery.trim().split(/\s+/).some((t) => t.length > 0 && t.length < 3) && (
        <p className="mb-3 text-xs text-gray-400">Short search terms may take a moment — adding more characters speeds things up.</p>
      )}

      <div className="overflow-x-auto">
        {error ? (
          <div className="py-10 text-center text-sm text-red-500">Search failed: {error}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-gray-400" aria-live="polite">
            {loading ? (
              <>
                <span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500 dark:border-gray-700 dark:border-t-indigo-400" />
                <span className={searchLoading && !warmingUp ? "animate-pulse" : undefined}>
                  {warmingUp ? "Backend waking up…" : searchLoading ? "Searching…" : "Loading…"}
                </span>
                {warmingUp && (
                  <span className="text-xs text-gray-300 dark:text-gray-600 text-center">
                    Cloud Run scales to zero when idle — first request takes ~30s
                  </span>
                )}
              </>
            ) : "No results."}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-800">
                {COLUMNS.map((col) => {
                  const isSorted = col.sortKey ? sort === col.sortKey : false;
                  const sortable = !!col.sortKey;
                  return (
                    <th
                      key={col.key}
                      {...(sortable ? { "data-testid": `sort-${col.sortKey}` } : {})}
                      onClick={sortable ? () => toggleSort(col.sortKey!) : undefined}
                      aria-sort={isSorted ? (dir === "asc" ? "ascending" : "descending") : "none"}
                      className={cn(
                        "px-3 py-2 font-medium text-gray-500 dark:text-gray-400",
                        sortable && "cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200",
                        col.numeric && "text-right",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortable && (
                          <span aria-hidden className={cn("text-xs", isSorted ? "text-indigo-500" : "text-transparent")}>
                            {isSorted ? (dir === "asc" ? "▲" : "▼") : "▲"}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={(row.id as string | number | undefined) ?? i}
                  data-testid="search-result"
                  data-id={row.id as string | number | undefined}
                  className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                >
                  {COLUMNS.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2 align-top", col.numeric && "text-right tabular-nums")}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Page {page} of{" "}
          {loading || externalTotal === null
            ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />
            : displayTotalPages}{" "}·{" "}
          <span data-testid="search-total" data-total={displayTotal}>
            {loading || externalTotal === null
              ? <span className="inline-block h-3 w-14 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />
              : displayTotal.toLocaleString()}
          </span>{" "}
          {loading || externalTotal === null
            ? <span className="inline-block h-3 w-10 animate-pulse rounded bg-gray-200 align-middle dark:bg-gray-700" />
            : "results"}
        </span>

        {displayTotalPages > 1 && (
          <nav aria-label="Pagination">
            <ul className="flex items-center gap-1">
              <li>
                <button type="button" data-testid="prev-page" onClick={() => goToAdjacentPage("prev")}
                  disabled={page <= 1 || loading}
                  className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">
                  Prev
                </button>
              </li>
              {pageItems.map((item) => {
                if (item === "left-ellipsis" || item === "right-ellipsis") {
                  return <li key={item} aria-hidden className="px-2 text-sm text-gray-400">…</li>;
                }
                const isActive = item === page;
                const handleClick =
                  item === page - 1 ? () => goToAdjacentPage("prev")
                  : item === page + 1 ? () => goToAdjacentPage("next")
                  : () => goToPage(item);
                return (
                  <li key={item} data-testid={`page-${item}`}>
                    <button type="button" onClick={handleClick}
                      aria-current={isActive ? "page" : undefined}
                      data-testid={isActive ? "current-page" : undefined}
                      className={cn(
                        "flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm transition-colors",
                        isActive ? "bg-indigo-600 text-white" : "border border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800",
                      )}>
                      {item}
                    </button>
                  </li>
                );
              })}
              <li>
                <button type="button" data-testid="next-page" onClick={() => goToAdjacentPage("next")}
                  disabled={page >= displayTotalPages || loading}
                  className="flex h-9 items-center rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">
                  Next
                </button>
              </li>
            </ul>
          </nav>
        )}
      </footer>
    </section>
  );
}
