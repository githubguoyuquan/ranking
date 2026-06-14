"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STORAGE_KEY = "ranking-device-id";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(STORAGE_KEY)?.trim();
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 32)
        : `dev-${Date.now().toString(36)}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000"
  );
}

/** 匿名设备偏好：watchlist / recentTopics（无需登录） */
export function SiteDevicePersonalization() {
  const [watchlist, setWatchlist] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const loadProfile = useCallback(async () => {
    const deviceId = getOrCreateDeviceId();
    if (!deviceId) return;
    try {
      const res = await fetch(`${apiBase()}/v1/site/profile`, {
        headers: { "X-Device-Id": deviceId },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { watchlist?: string[] };
      if (Array.isArray(data.watchlist)) {
        setWatchlist(data.watchlist.join(", "));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function save() {
    setLoading(true);
    setStatus("");
    try {
      const deviceId = getOrCreateDeviceId();
      const slugs = watchlist
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`${apiBase()}/v1/site/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
        },
        body: JSON.stringify({ watchlist: slugs, tier: "free" }),
      });
      setStatus(res.ok ? "已保存 watchlist" : `保存失败 HTTP ${res.status}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">个性化（匿名）</p>
        <p className="text-xs text-muted-foreground">
          本机设备 ID 识别，无需登录。填写关注话题 slug，逗号分隔。
        </p>
      </div>
      <div>
        <Label htmlFor="watchlist">Watchlist</Label>
        <Input
          id="watchlist"
          value={watchlist}
          onChange={(e) => setWatchlist(e.target.value)}
          placeholder="global-female-singers, demo-topic"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={loading}>
          {loading ? "保存中…" : "保存偏好"}
        </Button>
        {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
      </div>
    </div>
  );
}
