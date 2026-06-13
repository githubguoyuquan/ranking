"use client";

import { useCallback, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { AdminPage } from "@/components/admin-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiUrl } from "@/lib/api";
import { BACKEND_ADMIN_OPS } from "@/lib/backend-api-paths";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

type DrCheck = {
  code: string;
  severity: string;
  message: string;
  hint?: string;
};

export default function OpsPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<{
    status?: string;
    checks?: DrCheck[];
    deployment?: Record<string, string | null>;
  } | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  const load = useCallback(async (path: string, label: string) => {
    setStatus(`${label}…`);
    const res = await fetch(apiUrl(path), { headers: apiHeaders() });
    const text = await res.text();
    setRaw(text);
    setStatus(res.ok ? `${label} ok` : `${label} HTTP ${res.status}`);
    if (path === BACKEND_ADMIN_OPS.drReadiness && res.ok) {
      try {
        setReadiness(JSON.parse(text) as typeof readiness);
      } catch {
        setReadiness(null);
      }
    }
  }, []);

  const severityClass = (s: string) => {
    if (s === "critical") return "text-red-600";
    if (s === "warn") return "text-amber-600";
    return "text-green-700";
  };

  return (
    <AdminPage
      title="DR / K8s 运维"
      description="灾备就绪检查、K8s 探针聚合与 Outbox 重放计划。详见 docs/ops/DR_RUNBOOK.md。"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void load(BACKEND_ADMIN_OPS.drReadiness, "DR readiness")}>
            DR readiness
          </Button>
          <Button type="button" onClick={() => void load(BACKEND_ADMIN_OPS.k8sProbes, "K8s probes")}>
            K8s probes
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void load(BACKEND_ADMIN_OPS.outboxReplayPlan, "Outbox replay plan")}
          >
            Outbox replay plan
          </Button>
        </CardContent>
      </Card>

      {readiness?.checks && readiness.checks.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">
              检查清单{" "}
              <span className={severityClass(readiness.status ?? "ok")}>
                ({readiness.status})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {readiness.checks.map((c) => (
                <li key={c.code}>
                  <span className={`font-medium ${severityClass(c.severity)}`}>
                    [{c.severity}]
                  </span>{" "}
                  {c.message}
                  {c.hint ? (
                    <span className="block text-muted-foreground text-xs">{c.hint}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {readiness.deployment && (
              <p className="mt-3 text-xs text-muted-foreground">
                region={readiness.deployment.region ?? "—"} cluster=
                {readiness.deployment.cluster ?? "—"} ns=
                {readiness.deployment.k8sNamespace ?? "—"}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {status && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">{status}</CardTitle>
          </CardHeader>
          {raw && (
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{raw}</pre>
            </CardContent>
          )}
        </Card>
      )}

      <AdminFooterNav />
    </AdminPage>
  );
}
