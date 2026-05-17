"use client";

import { buildAdminAppAbsUrl } from "@/lib/admin-web-paths";
import { useEffect, useState } from "react";

/** 浏览器 `location.origin`，挂载后为当前管理台站点（用于分享绝对链接）。 */
export function useAdminAppUrl() {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  return {
    origin,
    abs: (path: string) => buildAdminAppAbsUrl(origin, path),
  };
}
