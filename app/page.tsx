import Dashboard from "@/components/Dashboard";
import type { RawAggregate } from "@/components/Chart";

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

async function fetchInitialAggregates(): Promise<{ data: RawAggregate[]; totalOrders: number | null }> {
  const to = isoDay(new Date());
  const from = "2020-01-01";
  const base = process.env.SPRING_API_URL ?? "http://localhost:8080";
  try {
    const res = await fetch(
      `${base}/api/aggregates?from=${from}&to=${to}&topCategories=4`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return { data: [], totalOrders: null };
    const json = await res.json();
    return {
      data: Array.isArray(json.data) ? json.data : [],
      totalOrders: typeof json.totalOrders === "number" ? json.totalOrders : null,
    };
  } catch {
    return { data: [], totalOrders: null };
  }
}

export default async function Page() {
  const { data: initialAggregates, totalOrders: initialApiTotal } = await fetchInitialAggregates();
  return <Dashboard initialAggregates={initialAggregates} initialApiTotal={initialApiTotal} />;
}
