const base = require('../../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  // Match CI (tests.yml --coverageProvider=v8); istanbul vs v8 count differently.
  coverageProvider: 'v8',
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // @ohif/ui* are symlinked raw JSX/TS; default transformIgnorePatterns skips
    // node_modules, so they must be stubbed for any component/hook test.
    '^@ohif/ui$': '<rootDir>/src/test-utils/__mocks__/ohif-ui.tsx',
    '^@ohif/ui-next$': '<rootDir>/src/test-utils/__mocks__/ohif-ui-next.tsx',
    // @ohif/core's dist isn't built under CI's frozen install; map to a stub so
    // jest never has to resolve the real package (a jest.mock factory can't).
    '^@ohif/core$': '<rootDir>/src/test-utils/__mocks__/ohif-core.ts',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/__mocks__/fileMock.js',
  },
  // Narrow coverage to meaningful product source; exclude boilerplate/scaffolding.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/index.tsx',
    '!src/**/index.{ts,tsx}',
    '!src/id.ts',
    '!src/__mocks__/**',
    '!src/test-utils/**',
    '!src/types/**',
  ],
};
