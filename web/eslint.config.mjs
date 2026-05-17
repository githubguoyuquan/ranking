import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** `eslint-config-next` v16 已是 flat config，勿再用 FlatCompat 包一层（会触发循环结构校验错误）。 */
const eslintConfig = [
  ...nextCoreWebVitals,
  /**
   * react-hooks v7：与常见「searchParams → useState」水合、`edit` 行选中同步表单等模式冲突；
   * 关闭后仍以 hooks 规则主体（exhaustive-deps 等）为准。
   */
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["eslint.config.mjs"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
];

export default eslintConfig;
