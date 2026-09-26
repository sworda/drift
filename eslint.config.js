import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * provider SDK 的包名模式。packages/llm 之外既不许静态 import，也不许动态 import()。
 * no-restricted-imports 只看得见 ImportDeclaration，动态形式必须由下面的
 * ImportExpression 选择器兜住（RESEARCH §5.4 静默失效 #2）。
 */
const PROVIDER_SDK_RE = String.raw`^(@ai-sdk\/|openai$|@anthropic-ai\/)`;

/**
 * 仓库级 no-restricted-syntax 的全部必需条目。
 *
 * ⚠️ flat config 对同一规则的 options 是**替换而非合并**：任何为子目录再设
 * no-restricted-syntax 的块，如果不 spread 本常量，就会静默删掉 model 字面量禁令
 * 与 as GatedText 禁令，而 lint 依然全绿（RESEARCH §5.4 静默失效 #1）。
 * tools/ci/eslint-config-meta.test.ts 用 ESLint#calculateConfigForFile 读回每个包的
 * 有效配置并逐条比对本常量，就是为了让那种静默删除变成一次红色测试。
 */
export const REQUIRED_RESTRICTED_SYNTAX = [
  {
    selector: "Property[key.name='model'] > :matches(Literal, TemplateLiteral)",
    message:
      'AI SDK 的字符串 model 写法默认路由到 Vercel AI Gateway —— 境外中转、无法备案。必须传 provider 实例（PLAT-06）。',
  },
  {
    selector:
      "TSAsExpression[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^GatedText$/]",
    message: 'GatedText 只能由 packages/safety 的 safetyGateway() 产出。不要断言。',
  },
  {
    selector:
      "TSTypeAssertion[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^GatedText$/]",
    message: 'GatedText 只能由 packages/safety 的 safetyGateway() 产出。尖括号断言同样禁止。',
  },
  {
    selector:
      "TSAsExpression[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^SyntheticText$/]",
    message: 'SyntheticText 只能由合成管道产出。不要断言真实用户原文为 synthetic（PLAT-07）。',
  },
  {
    selector:
      "TSTypeAssertion[typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name=/^SyntheticText$/]",
    message: 'SyntheticText 只能由合成管道产出。尖括号断言同样禁止（PLAT-07）。',
  },
  {
    selector: `ImportExpression[source.value=/${PROVIDER_SDK_RE}/]`,
    message:
      'no-restricted-imports 看不见 ImportExpression —— 动态 import() provider SDK 会绕过「packages/llm 是唯一导入者」边界，故此条不可删。',
  },
];

/** packages/llm 之外禁止静态导入 provider SDK。 */
const RESTRICTED_PROVIDER_IMPORTS = [
  'error',
  {
    patterns: [
      {
        group: ['@ai-sdk/*', '@ai-sdk', 'openai', 'openai/*', '@anthropic-ai/*'],
        message:
          'provider SDK 只能在 packages/llm 里导入 —— 它是 Model Router 的唯一入口（PLAT-03/06）。',
      },
    ],
  },
];

/** 三层出口防线里唯一能堵住 any 通道的一层。不得降级为 warn 或 off。 */
const TYPE_AWARE_ANY_DEFENSE = {
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
};

export default [
  {
    // 负向 fixture 目录故意违反检查，必须排除出常规 lint 范围 —— 它们只由
    // tools/ci/eslint-config-meta.test.ts 与 type-fixture-negative.test.ts 专门驱动。
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'coverage/**',
      'var/**',
      'tools/ci/fixtures/**',
      'tools/ci/type-fixtures/**',
    ],
  },
  {
    // 配置与脚本类 JS：不做 type-aware，但语法类禁令同样生效。
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
      'no-restricted-imports': RESTRICTED_PROVIDER_IMPORTS,
    },
  },
  {
    // 仓库级 TypeScript 块：type-aware。
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
      'no-restricted-imports': RESTRICTED_PROVIDER_IMPORTS,
      ...TYPE_AWARE_ANY_DEFENSE,
    },
  },
  {
    // packages/llm 是 provider SDK 的唯一导入者，只豁免 no-restricted-imports。
    // no-restricted-syntax 必须 spread 仓库级条目 —— 不 spread 就会静默丢掉全部禁令。
    files: ['packages/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
    },
  },
  {
    // 负向 lint fixture：被上面的 ignores 排除出常规运行；元测试用 ignore:false
    // 显式 lint 它们。这里关掉 type-aware（fixture 不属于任何 tsconfig 的范围）。
    files: ['tools/ci/fixtures/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: false, project: null },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
      'no-restricted-imports': RESTRICTED_PROVIDER_IMPORTS,
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
];
