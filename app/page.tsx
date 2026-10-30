import Dashboard from "@/components/Dashboard";
import type { RawAggregate } from "@/components/Chart";

async function fetchInitialAggregates(): Promise<{ data: RawAggregate[]; totalOrders: number | null }> {
  const base = process.env.SPRING_API_URL ?? "http://localhost:8080";
  try {
    const boundsRes = await fetch(`${base}/api/dataset-bounds`, { next: { revalidate: 3600 } });
    if (!boundsRes.ok) return { data: [], totalOrders: null };
    const bounds = await boundsRes.json() as { from: string; to: string };
    if (!bounds.to) return { data: [], totalOrders: null };
    const end = new Date(`${bounds.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 89);
    const from = end.toISOString().slice(0, 10);
    const res = await fetch(
      `${base}/api/aggregates?from=${from}&to=${bounds.to}&topCategories=4`,
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
