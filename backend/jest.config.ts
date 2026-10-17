import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts', 'mjs'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // .mjs включён: jsdom 29 тянет ESM-only-пакеты (см. transformIgnorePatterns),
    // которые ts-jest транслирует в CJS с allowJs для реальной санитизации в unit-тестах.
    '^.+\\.[tj]sx?$|^.+\\.[m]js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', esModuleInterop: true } },
    ],
  },
  // jsdom 29 в pnpm-layout тянет ESM-only transitive deps (@exodus/bytes, css-tree,
  // parse5, entities, tough-cookie, @csstools/*, @asamuzakjp/*, @bramus/specificity),
  // которые Jest 29 (CJS-рантайм) не может require без трансформации. Whitelist
  // разрешает трансформировать только их — остальной node_modules не трогаем.
  transformIgnorePatterns: [
    '^(?!.*(?:@asamuzakjp\\+|@bramus\\+|@csstools\\+|@exodus\\+bytes@|css-tree@|lru-cache@|parse5@|entities@|tough-cookie@)).*node_modules/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!**/*.dto.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
