import Dashboard from "@/components/Dashboard";
import type { RawAggregate } from "@/components/Chart";

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

async function fetchInitialAggregates(): Promise<RawAggregate[]> {
  const to = isoDay(new Date());
  const from = isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const base = process.env.SPRING_API_URL ?? "http://localhost:8080";
  try {
    const res = await fetch(
      `${base}/api/aggregates?from=${from}&to=${to}&topCategories=4&includeData=true`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

export default async function Page() {
  const initialAggregates = await fetchInitialAggregates();
  return <Dashboard initialAggregates={initialAggregates} />;
}
