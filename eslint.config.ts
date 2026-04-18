import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @see https://typescript-eslint.io/getting-started
 * @see https://eslint.org/docs/latest/use/configure/migration-guide#configure-language-options
 */
const eslintConfig = defineConfig(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

export default eslintConfig;
