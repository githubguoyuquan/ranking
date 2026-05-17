"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function CopyTextButton({
  text,
  idleLabel,
  copiedLabel = "已复制",
  className,
}: {
  text: string;
  idleLabel: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = text.trim().length > 0;

  async function copy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!canCopy}
      className={cn("h-7 text-xs", className)}
      onClick={() => void copy()}
      aria-label={copied ? copiedLabel : idleLabel}
      title={
        text.length > 160 ? `${text.slice(0, 160).trim()}…` : text || undefined
      }
    >
      {copied ? copiedLabel : idleLabel}
    </Button>
  );
}

export function CopySnapshotIdButton({ id }: { id: string }) {
  return <CopyTextButton text={id} idleLabel="复制 id" />;
}
