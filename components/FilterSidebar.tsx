"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface RegionOption {
  code: string;
  name: string;
}

export interface OrderFilters {
  status: string[];
  regionCodes: string[];
  from: string;
  to: string;
  totalMin: string;
  totalMax: string;
}

export const EMPTY_FILTERS: OrderFilters = {
  status: [],
  regionCodes: [],
  from: "",
  to: "",
  totalMin: "",
  totalMax: "",
};

export function appendFilterParams(
  params: URLSearchParams,
  f?: OrderFilters,
): void {
  if (!f) return;
  if (f.status.length) params.set("status", f.status.join(","));
  if (f.regionCodes.length) params.set("regionCode", f.regionCodes.join(","));
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.totalMin) params.set("minTotal", f.totalMin);
  if (f.totalMax) params.set("maxTotal", f.totalMax);
}

export function isEmptyFilters(f: OrderFilters): boolean {
  return (
    f.status.length === 0 &&
    f.regionCodes.length === 0 &&
    !f.from &&
    !f.to &&
    !f.totalMin &&
    !f.totalMax
  );
}

interface FilterSidebarProps {
  value: OrderFilters;
  onChange: (next: OrderFilters) => void;
  regionOptions: RegionOption[];
}

interface Chip {
  key: string;
  label: string;
  clear: () => void;
}

function cn(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

interface ComboOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  legend: string;
  options: ComboOption[];
  selected: string[];
  onToggle: (value: string) => void;
  searchTestId: string;
  optionTestId: (value: string) => string;
  placeholder: string;
  emptyText?: string;
}

function MultiSelectFilter({
  legend,
  options,
  selected,
  onToggle,
  searchTestId,
  optionTestId,
  placeholder,
  emptyText,
}: MultiSelectFilterProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listboxId = `${searchTestId}-listbox`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q),
        )
      : options;
    return [...matches].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
  }, [options, query]);

  const labelFor = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {legend}
      </legend>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              {labelFor(v)}
              <button
                type="button"
                onClick={() => onToggle(v)}
                aria-label={`Remove ${labelFor(v)}`}
                className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="search"
          data-testid={searchTestId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={`Filter ${legend} options`}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />

        {open && (
          <div
            role="listbox"
            id={listboxId}
            className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-950"
          >
            {options.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-400">
                {emptyText ?? "No options."}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-1 text-xs text-gray-400">No matches.</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={optionTestId(opt.value)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onToggle(opt.value)}
                    className={cn(
                      "flex w-full items-center justify-between px-2 py-1 text-left text-sm",
                      isSelected
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800",
                    )}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <span aria-hidden>✓</span>}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}

export default function FilterSidebar({
  value,
  onChange,
  regionOptions,
}: FilterSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const patch = (p: Partial<OrderFilters>) => onChange({ ...value, ...p });

  const [localMin, setLocalMin] = useState(value.totalMin);
  const [localMax, setLocalMax] = useState(value.totalMax);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setLocalMin(value.totalMin); }, [value.totalMin]);
  useEffect(() => { setLocalMax(value.totalMax); }, [value.totalMax]);

  const commitTotal = (min: string, max: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => patch({ totalMin: min, totalMax: max }), 400);
  };

  const toggleIn = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const toggleStatus = (s: string) =>
    patch({ status: toggleIn(value.status, s) });
  const toggleRegion = (c: string) =>
    patch({ regionCodes: toggleIn(value.regionCodes, c) });

  const statusComboOptions: ComboOption[] = useMemo(
    () => ORDER_STATUSES.map((s) => ({ value: s, label: s })),
    [],
  );
  const regionComboOptions: ComboOption[] = useMemo(
    () => regionOptions.map((r) => ({ value: r.code, label: r.name || r.code })),
    [regionOptions],
  );

  const otherChips: Chip[] = [
    ...(value.from || value.to
      ? [
          {
            key: "date",
            label: `${value.from || "…"} → ${value.to || "…"}`,
            clear: () => patch({ from: "", to: "" }),
          },
        ]
      : []),
    ...(value.totalMin || value.totalMax
      ? [
          {
            key: "total",
            label: `$${value.totalMin || "0"} – $${value.totalMax || "∞"}`,
            clear: () => patch({ totalMin: "", totalMax: "" }),
          },
        ]
      : []),
  ];

  const anyActive = !isEmptyFilters(value);

  const fieldCls =
    "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100";

  const body = (
    <div className="space-y-5">
      {anyActive && (
        <div className="space-y-2">
          {otherChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {otherChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label}`}
                    className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            data-testid="filter-clear"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Clear all
          </button>
        </div>
      )}

      <MultiSelectFilter
        legend="Status"
        options={statusComboOptions}
        selected={value.status}
        onToggle={toggleStatus}
        searchTestId="filter-status-search"
        optionTestId={(s) => `filter-status-${s}`}
        placeholder="Search status…"
      />

      <MultiSelectFilter
        legend="Region"
        options={regionComboOptions}
        selected={value.regionCodes}
        onToggle={toggleRegion}
        searchTestId="filter-region-search"
        optionTestId={(c) => `filter-region-${c}`}
        placeholder="Search region…"
        emptyText="No regions loaded yet."
      />

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Placed date
        </legend>
        <label className="block text-xs text-gray-500">
          From
          <input
            type="date"
            value={value.from}
            onChange={(e) => patch({ from: e.target.value })}
            className={fieldCls}
          />
        </label>
        <label className="block text-xs text-gray-500">
          To
          <input
            type="date"
            value={value.to}
            onChange={(e) => patch({ to: e.target.value })}
            className={fieldCls}
          />
        </label>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Order total
        </legend>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Min"
            value={localMin}
            onChange={(e) => { setLocalMin(e.target.value); commitTotal(e.target.value, localMax); }}
            className={fieldCls}
            aria-label="Minimum total"
          />
          <span className="text-gray-400">–</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Max"
            value={localMax}
            onChange={(e) => { setLocalMax(e.target.value); commitTotal(localMin, e.target.value); }}
            className={fieldCls}
            aria-label="Maximum total"
          />
        </div>
      </fieldset>
    </div>
  );

  const chipCount =
    value.status.length +
    value.regionCodes.length +
    (value.from || value.to ? 1 : 0) +
    (value.totalMin || value.totalMax ? 1 : 0);

  return (
    <div className="lg:w-64 lg:shrink-0">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="mb-4 inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm lg:hidden dark:border-gray-700"
      >
        Filters{chipCount > 0 ? ` (${chipCount})` : ""}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        data-testid="filter-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 transform overflow-y-auto border-r border-gray-200 bg-white p-4 shadow-lg transition-transform dark:border-gray-800 dark:bg-gray-900",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0 lg:rounded-lg lg:border lg:shadow-sm",
          collapsed ? "lg:w-12" : "lg:w-64",
        )}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className={cn("text-base font-semibold", collapsed && "lg:hidden")}>
            Filters
          </h2>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand filters" : "Collapse filters"}
            className="hidden rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:block dark:hover:bg-gray-800"
          >
            {collapsed ? "»" : "«"}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close filters"
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:hidden dark:hover:bg-gray-800"
          >
            ×
          </button>
        </header>

        <div className={cn(collapsed && "lg:hidden")}>{body}</div>
      </aside>
    </div>
  );
}
