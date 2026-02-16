import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-plugin-prettier";
import configPrettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  configPrettier,
  {
    plugins: {
      prettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "agent-rules/**",
      "agent-rules-tools/**",
      "agent-rules-local/**",
      "data/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
