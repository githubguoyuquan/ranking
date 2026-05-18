"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AdminChromeContextValue = {
  /** 为 true 时隐藏侧栏，主区域占满视口（用于引擎监控等沉浸模式） */
  sidebarHidden: boolean;
  setSidebarHidden: (hidden: boolean) => void;
  toggleSidebarHidden: () => void;
};

const AdminChromeContext = createContext<AdminChromeContextValue | null>(null);

export function AdminChromeProvider({ children }: { children: ReactNode }) {
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const toggleSidebarHidden = useCallback(() => {
    setSidebarHidden((s) => !s);
  }, []);
  const value = useMemo(
    () => ({
      sidebarHidden,
      setSidebarHidden,
      toggleSidebarHidden,
    }),
    [sidebarHidden, toggleSidebarHidden],
  );
  return (
    <AdminChromeContext.Provider value={value}>
      {children}
    </AdminChromeContext.Provider>
  );
}

export function useAdminChrome(): AdminChromeContextValue {
  const ctx = useContext(AdminChromeContext);
  if (!ctx) {
    throw new Error("useAdminChrome must be used within AdminChromeProvider");
  }
  return ctx;
}
