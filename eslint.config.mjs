import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    // Links <a> para /api/* são downloads de arquivos (PDF, ZIP, CSV), não navegação.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];
export default config;
