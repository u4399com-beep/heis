import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ---------------------------------------------------------------------------
    // TypeScript rules
    // ---------------------------------------------------------------------------
    // `no-explicit-any` 暂时关闭: 119 处合法 DOM-interop + catch 块
    // (cheerio/xpath/playwright/SSE stream 等) 全面重构成本过大,
    // 单独跟踪作为未来一次专门 pass。复杂 DOM-interop 处加 disable 注释说明原因。
    "@typescript-eslint/no-explicit-any": "off",
    // unused vars 已重新启用(下方 General 段), 仅 TS 别名同义重复保持关闭。
    "@typescript-eslint/no-non-null-assertion": "off", // Prisma 返回可能为 null, 实用性非空断言
    "@typescript-eslint/ban-ts-comment": "off", // 我们带原因使用 eslint-disable-next-line
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // ---------------------------------------------------------------------------
    // React rules
    // ---------------------------------------------------------------------------
    "react-hooks/exhaustive-deps": "warn", // Task 2-a: 重新启用 (warn, 修复风险大的留作 review)
    "react-hooks/purity": "off", // 实验性
    "react/no-unescaped-entities": "off", // shadcn/ui + Next 约定
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off", // 实验性

    // ---------------------------------------------------------------------------
    // Next.js rules
    // ---------------------------------------------------------------------------
    "@next/next/no-img-element": "off", // shadcn/ui + Next 约定
    "@next/next/no-html-link-for-pages": "off",

    // ---------------------------------------------------------------------------
    // General JavaScript / TypeScript rules (Task 2-a: 重新启用)
    // ---------------------------------------------------------------------------
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_", // 允许 catch (_e) {} 或 catch (e) {} 不报错
    }],
    "no-unused-vars": "off", // TS 版本接管
    "prefer-const": ["error", { destructuring: "all" }],
    "no-unreachable": "error",
    "no-fallthrough": "error",
    "no-useless-escape": "error",
    "no-redeclare": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-case-declarations": "error",
    "no-irregular-whitespace": "error",
    "no-debugger": "error", // Task 2-a: 重新启用 (禁止提交 debugger 语句)

    // 仍保持关闭:
    "no-console": "off", // logger 和 mini-service banner 需要 console
    "no-empty": "off", // 防御性空 catch 已注释说明
    "no-undef": "off", // TS 编译器接管
  },
}, {
  // mini-services/**/.venv: Python 虚拟环境(如 scrapling-bridge/.venv, 数万包 babel 反优化
  // lint OOM/SIGKILL, hh-b 移交项) —— 独立子项目不入主 lint 面(mini-services 也不参与主 tsc)
  // scripts/**: Task 2-a 明确声明 scripts 与 mini-services 独立 tsconfig/quality-gate,
  //   不参与主 tsc/lint 门(verify-* 脚本另有独立校验;seed/mock 仅开发期一次性运行)
  // tmp/**: 运行时暂存(截图/原站 HTML+CSS+JS 资产留证, mm 轮), 非源码不入质量门
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "mini-services/**", "scripts/**", "tmp/**"]
}];

export default eslintConfig;
