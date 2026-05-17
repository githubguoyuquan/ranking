"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

type EntityRow = {
  id: string;
  type: string;
  canonicalName: string;
  aliases?: unknown;
};

function aliasesLabel(a: unknown): string {
  if (a == null) return "—";
  if (Array.isArray(a)) return a.filter((x) => typeof x === "string").join(", ");
  return JSON.stringify(a);
}

export default function EntitiesPage() {
  const [listQ, setListQ] = useState("");
  const listQRef = useRef(listQ);
  listQRef.current = listQ;
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [listError, setListError] = useState("");
  const [name, setName] = useState("New Artist");
  const [type, setType] = useState("PERSON");
  const [aliases, setAliases] = useState("A,B");
  const [createOut, setCreateOut] = useState("");
  const [edit, setEdit] = useState<EntityRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [editMsg, setEditMsg] = useState("");

  const loadList = useCallback(async () => {
    setListError("");
    const q = listQRef.current.trim();
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (q) params.set("q", q);
      const res = await fetch(`${getApiBase()}/admin/entities?${params}`, {
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        setListError(`HTTP ${res.status}\n${text}`);
        setRows([]);
        return;
      }
      const data = JSON.parse(text) as unknown;
      if (!Array.isArray(data)) {
        setListError("响应不是数组");
        setRows([]);
        return;
      }
      setRows(data as EntityRow[]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!edit) return;
    setEditName(edit.canonicalName);
    setEditType(edit.type);
    setEditAliases(aliasesLabel(edit.aliases).replace(/^—$/, ""));
  }, [edit]);

  async function createEntity() {
    setCreateOut("");
    const al = aliases
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`${getApiBase()}/admin/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalName: name.trim(),
          type: type.trim() || "PERSON",
          aliases: al.length ? al : undefined,
        }),
      });
      setCreateOut(await res.text());
      void loadList();
    } catch (e) {
      setCreateOut(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setEditMsg("");
    const al = editAliases
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch(
        `${getApiBase()}/admin/entities/${encodeURIComponent(edit.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonicalName: editName.trim(),
            type: editType.trim() || undefined,
            aliases: al,
          }),
        },
      );
      setEditMsg(`${res.status} ${await res.text()}`);
      if (res.ok) {
        setEdit(null);
        void loadList();
      }
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEntity(id: string) {
    if (!window.confirm(`删除实体 #${id}？（启用 ES 时先写 delete Outbox）`)) return;
    setEditMsg("");
    try {
      const res = await fetch(`${getApiBase()}/admin/entities/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setEditMsg(`DELETE ${res.status} ${await res.text()}`);
      setEdit((e) => (e?.id === id ? null : e));
      void loadList();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">实体</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          GET /admin/entities · POST /admin/entities · PATCH/DELETE
          /admin/entities/:id
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">列表</CardTitle>
          <CardDescription>按 canonicalName 子串筛选 · 表格内编辑/删除</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="q">q</Label>
              <Input
                id="q"
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
              />
            </div>
            <Button type="button" onClick={() => void loadList()}>
              刷新
            </Button>
          </div>
          {listError ? (
            <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">
              {listError}
            </pre>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">id</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">别名</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                      <td className="px-3 py-2">{r.canonicalName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.type}</td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground">
                        {aliasesLabel(r.aliases)}
                      </td>
                      <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setEdit(r)}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => void removeEntity(r.id)}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">暂无数据</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {edit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">编辑 #{edit.id}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>canonicalName</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>type</Label>
              <Input value={editType} onChange={(e) => setEditType(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>aliases（逗号分隔；保存时覆盖）</Label>
              <Input value={editAliases} onChange={(e) => setEditAliases(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="button" onClick={() => void saveEdit()}>
                PATCH 保存
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
                取消
              </Button>
            </div>
            {editMsg ? (
              <pre className="sm:col-span-2 text-xs whitespace-pre-wrap">{editMsg}</pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>canonicalName</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>type</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>aliases（逗号分隔）</Label>
            <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </div>
          <Button type="button" className="sm:col-span-2" onClick={() => void createEntity()}>
            POST /admin/entities
          </Button>
          {createOut ? (
            <pre className="sm:col-span-2 text-xs whitespace-pre-wrap">{createOut}</pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
