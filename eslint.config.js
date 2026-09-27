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
const PROVIDER_IMPORT_PATTERN = {
  group: ['@ai-sdk/*', '@ai-sdk', 'openai', 'openai/*', '@anthropic-ai/*'],
  message:
    'provider SDK 只能在 packages/llm 里导入 —— 它是 Model Router 的唯一入口（PLAT-03/06）。',
};

/**
 * apps/api/src/ws/** 之外禁止导入 ws（RESEARCH §2.1 四条不可协商包边界之一）。
 * 「WS 下发只接受 GatedText」这条约束的执行点只有那一个模块；别处能 new WebSocketServer
 * 就等于多了一个不受约束的出口，而 lint 会一直是绿的。
 */
const WS_IMPORT_PATTERN = {
  // 用 regex 而不是 group：gitignore 风格的 group 会把相对路径 './ws/server.ts'
  // 也算作命中（实测），从而把「唯一导入者」这条边界变成「谁都不能引用 ws 目录」。
  regex: String.raw`^ws(/|$)`,
  message:
    'ws 的唯一导入者是 apps/api/src/ws/** —— 新开一个 WebSocketServer 会绕过「下发只接受 GatedText」这条约束（D-15）。',
};

/**
 * `decryptContact` 的唯一合法消费者是 apps/api/src/modules/safety/**（危机流程要把
 * 紧急联系人的号码遮蔽后显示给用户）。别处需要的是 `maskContact`，不是明文。
 *
 * 联系方式是**第三方**的个人信息 —— 用户代监护人 / 紧急联系人填了号码，而那个人并没有
 * 同意我们展示它。把这条边界写进 lint 而不是写进注释，是因为注释不会变红。
 * 所有者 packages/db（实现与它自己的单元测试）另行豁免。
 */
const DECRYPT_CONTACT_IMPORT_PATTERN = {
  group: ['@drift/db'],
  importNames: ['decryptContact'],
  message:
    'decryptContact 只能在 apps/api/src/modules/safety/** 使用 —— 紧急联系人的号码是第三方的个人信息，别处要的是 maskContact（Plan 09 / T-09-03）。',
};

/**
 * 三条导入边界的作用域不同（packages/llm 豁免 provider，apps/api/src/ws 豁免 ws，
 * apps/api/src/modules/safety 与 packages/db 豁免 decryptContact），
 * 而 flat config 对同一规则是**替换而非合并** —— 因此必须从这里组装，不能靠叠加。
 */
function restrictedImports({ providers = true, ws = true, decrypt = true } = {}) {
  const patterns = [];
  if (providers) patterns.push(PROVIDER_IMPORT_PATTERN);
  if (ws) patterns.push(WS_IMPORT_PATTERN);
  if (decrypt) patterns.push(DECRYPT_CONTACT_IMPORT_PATTERN);
  return patterns.length === 0 ? 'off' : ['error', { patterns }];
}

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
      'no-restricted-imports': restrictedImports(),
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
      'no-restricted-imports': restrictedImports(),
      ...TYPE_AWARE_ANY_DEFENSE,
    },
  },
  {
    // packages/llm 是 provider SDK 的唯一导入者，只豁免 no-restricted-imports。
    // no-restricted-syntax 必须 spread 仓库级条目 —— 不 spread 就会静默丢掉全部禁令。
    files: ['packages/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ providers: false }),
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
    },
  },
  {
    // apps/api：唯一允许读 process.env 的文件是 src/config/env.ts，它在使用点上带一条
    // eslint-disable。其余模块必须用 env.ts 导出的只读 env 对象 —— 环境变量在启动时
    // 一次性校验并 exit 1，任何绕过它的直接读取都会让一个缺失变量延迟到「危机二级要
    // 通知运营者」那一刻才失败。
    // ⚠️ 必须 spread REQUIRED_RESTRICTED_SYNTAX：不 spread 就会静默删掉 model 字面量
    // 与 GatedText 断言两组禁令，而 lint 依然全绿。
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...REQUIRED_RESTRICTED_SYNTAX,
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'apps/api 里只有 src/config/env.ts 能读环境变量；其余模块 import { env } from 那个启动时已校验的只读对象。',
        },
      ],
    },
  },
  {
    // ws 的唯一导入者。只豁免 ws 这一条，provider SDK 的边界照旧。
    files: ['apps/api/src/ws/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ ws: false }),
    },
  },
  {
    // decryptContact 的唯一消费者：危机流程要把紧急联系人的号码遮蔽后显示。
    // 只豁免这一条，其余边界照旧。
    files: ['apps/api/src/modules/safety/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ decrypt: false }),
    },
  },
  {
    // decryptContact 的**所有者**。实现与它自己的单元测试都在这里。
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ decrypt: false }),
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
      'no-restricted-imports': restrictedImports(),
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // 负向 fixture（V.0 #2）：any 穿过接受 GatedText 的出口。
    //
    // ⚠️ 上面那个 fixtures 块把四条 no-unsafe-* 关掉了（那些 fixture 不属于任何
    // tsconfig）。但 no-unsafe-argument **只有 type-aware 才会被求值** —— 对这一个
    // fixture 沿用那份配置，等于让它永远是绿的，而它的全部意义恰恰是证明「any 通道
    // 被堵住了」这句话非空真。因此这一个文件有自己的 tsconfig，并在此把四条规则重新
    // 打开。块的位置必须在 fixtures 块**之后**：flat config 后块覆盖前块。
    files: ['tools/ci/fixtures/any-into-egress.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: false,
        project: './tools/ci/fixtures/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-restricted-syntax': ['error', ...REQUIRED_RESTRICTED_SYNTAX],
      'no-restricted-imports': restrictedImports(),
      ...TYPE_AWARE_ANY_DEFENSE,
    },
  },
];

