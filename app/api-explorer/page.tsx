"use client";

import { useEffect, useState } from "react";
import { DATASET_START_FALLBACK, DATASET_END_FALLBACK } from "./explorer-utils";
import { OrdersCard, SearchCard, AggregatesCard, BrushCard, CustomersCard } from "./endpoint-cards";

const PORTFOLIO_URL = "https://bganguly.github.io/#nextjs_springboot";

export default function ApiExplorer() {
  const [dsStart, setDsStart] = useState(DATASET_START_FALLBACK);
  const [dsEnd,   setDsEnd]   = useState(DATASET_END_FALLBACK);

  useEffect(() => {
    Promise.all([
      fetch("/api/orders?page=1&pageSize=1&sort=placedAt&dir=asc").then(r => r.ok ? r.json() : null),
      fetch("/api/orders?page=1&pageSize=1&sort=placedAt&dir=desc").then(r => r.ok ? r.json() : null),
    ]).then(([earlyJ, lateJ]) => {
      const s = String((earlyJ?.data?.[0]?.placedAt ?? "")).slice(0, 10);
      const e = String((lateJ?.data?.[0]?.placedAt ?? "")).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) setDsStart(s);
      if (/^\d{4}-\d{2}-\d{2}$/.test(e)) setDsEnd(e);
    }).catch(() => {});
  }, []);

  return (
    <div style={{ background:"#0f0f13", minHeight:"100vh" }} className="text-zinc-100 font-sans antialiased">
      <style>{`
        @keyframes api-explorer-spin { to { transform: rotate(360deg); } }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.5); cursor: pointer; }
      `}</style>

      <nav className="fixed top-0 inset-x-0 z-40 border-b"
        style={{ borderColor:"rgba(255,255,255,0.06)", background:"rgba(15,15,19,0.9)", backdropFilter:"blur(16px)" }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href={PORTFOLIO_URL}
            onClick={e => {
              e.preventDefault();
              const url = PORTFOLIO_URL;
              try { if (window.opener && !window.opener.closed) { window.opener.location.href = url; window.close(); return; } } catch (_) {}
              window.location.href = url;
            }}
            className="flex items-center gap-2 text-sm transition-colors"
            style={{ color:"#71717a" }}
            onMouseEnter={e => (e.currentTarget.style.color="#f4f4f5")}
            onMouseLeave={e => (e.currentTarget.style.color="#71717a")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
            </svg>
            Portfolio
          </a>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color:"#3f3f46" }}>Spring Boot Dashboard</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ background:"rgba(16,185,129,0.12)", border:"1px solid rgba(16,185,129,0.3)", color:"#34d399" }}>
              Next.js 15 · Spring Boot 4.1 · Neon
            </span>
          </div>
        </div>
      </nav>

      <section className="pt-28 pb-10 px-6 max-w-5xl mx-auto">
        <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:"#818cf8" }}>API Explorer</p>
        <h1 className="text-2xl font-bold mb-2" style={{ color:"#f4f4f5" }}>Live API — Spring Boot Dashboard</h1>
        <p className="text-sm max-w-xl" style={{ color:"#71717a" }}>
          Run real requests against the Spring Boot 4.1 REST API backed by Neon PostgreSQL.
          Calls are proxied through the Next.js frontend — the backend host is never exposed.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono"
            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"#52525b" }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background:"#818cf8" }} />
            {typeof window !== "undefined" ? window.location.origin : ""}/api
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono"
            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"#52525b" }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background:"#34d399" }} />
            dataset {dsStart} → {dsEnd}
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 max-w-5xl mx-auto space-y-5">
        <OrdersCard dsStart={dsStart} dsEnd={dsEnd} />
        <SearchCard dsStart={dsStart} dsEnd={dsEnd} />
        <AggregatesCard dsStart={dsStart} dsEnd={dsEnd} />
        <BrushCard dsStart={dsStart} dsEnd={dsEnd} />
        <CustomersCard />
      </section>
    </div>
  );
}
