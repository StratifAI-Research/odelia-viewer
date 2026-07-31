const base = require('../../jest.config.base.js');
const pkg = require('./package');

module.exports = {
  ...base,
  displayName: pkg.name,
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/__mocks__/fileMock.js',
    // Inherited last: jest applies the first matching pattern, and the
    // shared base carries generic '^@cornerstonejs/...' rules that would
    // otherwise shadow the explicit stubs above.
    ...base.moduleNameMapper,
  },
};
