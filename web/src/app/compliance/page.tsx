"use client";

import { useCallback, useState } from "react";

import { AdminFooterNav } from "@/components/admin-footer-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/api";

function apiHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_API_KEY?.trim();
  return key ? { "X-API-Key": key } : {};
}

export default function CompliancePage() {
  const [snapshotId, setSnapshotId] = useState("");
  const [tenantId, setTenantId] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setStatus("bootstrap…");
    const res = await fetch(apiUrl("/admin/compliance/bootstrap-default-tenant"), {
      method: "POST",
      headers: apiHeaders(),
    });
    const text = await res.text();
    setStatus(res.ok ? `bootstrap OK: ${text}` : `bootstrap ${res.status}: ${text}`);
  }, []);

  const createKey = useCallback(async () => {
    setStatus("creating API key…");
    setCreatedKey(null);
    const res = await fetch(apiUrl("/admin/compliance/api-keys"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiHeaders() },
      body: JSON.stringify({ tenantId, label: "admin-console", scopes: ["admin"] }),
    });
    const text = await res.text();
    if (!res.ok) {
      setStatus(`create key ${res.status}: ${text}`);
      return;
    }
    try {
      const j = JSON.parse(text) as { plaintext?: string };
      setCreatedKey(j.plaintext ?? null);
      setStatus("API key created (copy plaintext below)");
    } catch {
      setStatus(text);
    }
  }, [tenantId]);

  const exportSnapshot = useCallback(async () => {
    const id = snapshotId.trim();
    if (!id) return;
    setStatus("exporting…");
    const url = apiUrl(`/admin/compliance/snapshots/${id}/export?format=json`);
    const res = await fetch(url, { headers: apiHeaders() });
    const text = await res.text();
    if (!res.ok) {
      setStatus(`export ${res.status}: ${text.slice(0, 400)}`);
      return;
    }
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `snapshot-${id}-compliance.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`exported snapshot ${id}`);
  }, [snapshotId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">合规与导出</h1>
      <p className="text-sm text-muted-foreground">
        Phase D：多租户 API 密钥、快照法务包导出。生产请设 API_AUTH_REQUIRED，并在
        web/.env.local 配置 NEXT_PUBLIC_API_KEY。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">租户与密钥</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button type="button" onClick={() => void bootstrap()}>
            Bootstrap default 租户
          </Button>
          <div>
            <Label htmlFor="tenant-id">tenantId</Label>
            <Input
              id="tenant-id"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="mt-1 w-32"
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => void createKey()}>
            创建 admin API Key
          </Button>
        </CardContent>
      </Card>

      {createdKey ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-amber-700 dark:text-amber-400">
              新 API Key（仅显示一次）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="break-all text-sm">{createdKey}</code>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">快照合规导出</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="snapshot-id">snapshotId</Label>
            <Input
              id="snapshot-id"
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
              placeholder="1"
              className="mt-1 max-w-xs"
            />
          </div>
          <Button type="button" disabled={!snapshotId.trim()} onClick={() => void exportSnapshot()}>
            下载 JSON 法务包
          </Button>
        </CardContent>
      </Card>

      {status ? (
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{status}</pre>
      ) : null}

      <AdminFooterNav />
    </div>
  );
}