const base = require('../../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  name: pkg.name,
  displayName: pkg.name,
  coverageProvider: 'v8',
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@ohif/core$': '<rootDir>/src/test-utils/__mocks__/ohif-core.ts',
    '^@ohif/ui$': '<rootDir>/src/test-utils/__mocks__/ohif-ui.tsx',
    '^@ohif/ui-next$': '<rootDir>/src/test-utils/__mocks__/ohif-ui-next.tsx',
    '^@cornerstonejs/core$': '<rootDir>/src/test-utils/__mocks__/cornerstone-core.ts',
    '^@cornerstonejs/tools$': '<rootDir>/src/test-utils/__mocks__/cornerstone-tools.ts',
    '^@ohif/extension-cornerstone$': '<rootDir>/src/test-utils/__mocks__/ohif-ext-cornerstone.ts',
    '^@ohif/extension-default$': '<rootDir>/src/test-utils/__mocks__/ohif-ext-default.tsx',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/__mocks__/fileMock.js',
  },
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.test.{js,jsx,ts,tsx}',
    '!src/index.tsx',
    '!src/**/index.{ts,tsx}',
    '!src/id.js',
    '!src/__mocks__/**',
    '!src/test-utils/**',
    '!src/types/**',
    '!src/types.ts',
  ],
};
