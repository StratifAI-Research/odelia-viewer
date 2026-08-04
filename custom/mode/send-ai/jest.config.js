const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  moduleNameMapper: {
    // srDisplaySetContract.test.ts drives the REAL DisplaySetService and the REAL SOP class
    // handlers, so @ohif/core has to resolve from inside extensions/ too. The workspace link
    // exists; what fails is the entry point -- platform/core's `main` is
    // dist/ohif-core.umd.js, which is not built, and jest resolves `main`. Production reads its
    // `module: src/index.ts` instead, so mapping to source is what the bundler effectively does.
    // Scoped to `src/` subpaths rather than a catch-all, which would mis-map anything else.
    '^@ohif/core$': '<rootDir>/../../../platform/core/src',
    '^@ohif/core/src/(.*)$': '<rootDir>/../../../platform/core/src/$1',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/__mocks__/fileMock.js',
    // Inherited last: jest applies the first matching pattern, and the
    // shared base carries generic '^@cornerstonejs/...' rules that would
    // otherwise shadow the explicit stubs above.
    ...base.moduleNameMapper,
  },
};
