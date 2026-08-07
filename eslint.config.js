import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Lint focado em **defeito**, não em estilo — formatação é trabalho do
 * Prettier, e o `eslint-config-prettier` no fim desliga tudo que conflitaria.
 *
 * As regras que exigiriam varrer o código inteiro entram como `warn`: elas
 * apontam dívida real (o `any` nas fronteiras da DI, por exemplo), mas
 * transformá-las em erro agora reprovaria o CI por algo que precisa de trabalho
 * próprio, não de um `eslint --fix`.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "docs/**",
      "packages/flow/src/ui/**", // build próprio, com JSX e tsconfig separado
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortSignal: "readonly",
        Response: "readonly",
        RequestInit: "readonly",
      },
    },
    rules: {
      // Parâmetro não usado prefixado com `_` é intenção, não esquecimento —
      // aparece em toda assinatura de middleware que ignora a invocação.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],

      // Dívida conhecida e localizada: as fronteiras da DI (`instance`, o plano
      // de injeção), a invocação dos middlewares e o parsing do JSON cru que
      // vem das APIs dos providers. Tipá-las de verdade é trabalho próprio —
      // enquanto isso, fica visível.
      "@typescript-eslint/no-explicit-any": "warn",

      // `Function` é usado de propósito onde o framework aceita "a classe",
      // sem constranger a assinatura: `runWorkflow(WorkflowClass: Function)`,
      // e os `WeakMap<Function, Metadata>` dos decorators.
      //
      // A crítica da regra procede — hoje `bootstrapWorkflow(() => {})`
      // compila. O conserto é introduzir um `ClassLike` e trocar 19
      // assinaturas, várias delas públicas: tarefa com risco próprio, não
      // item de higiene. Fica como aviso até lá.
      "@typescript-eslint/no-unsafe-function-type": "warn",

      // O framework lança `Error` em todo lugar; nunca uma string.
      "no-throw-literal": "error",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off", // o logger e o CLI escrevem no console de propósito
    },
  },

  {
    files: ["**/test/**/*.ts"],
    rules: {
      // Teste monta classe e provider de mentira o tempo todo.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  prettier,
);
