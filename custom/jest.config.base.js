const base = require('../jest.config.base.js');

// The root base config resolves the repo-root node_modules as
// `<rootDir>/../../node_modules`, which is correct for platform/* and
// extensions/* but not for the custom packages: they live one level deeper
// (custom/extension/*, custom/mode/*), so that path lands on custom/node_modules
// and every @cornerstonejs mapping fails to resolve.
const FROM_PACKAGE = '<rootDir>/../../node_modules';
const FROM_CUSTOM_PACKAGE = '<rootDir>/../../../node_modules';

const moduleNameMapper = Object.fromEntries(
  Object.entries(base.moduleNameMapper).map(([pattern, target]) => [
    pattern,
    typeof target === 'string' ? target.split(FROM_PACKAGE).join(FROM_CUSTOM_PACKAGE) : target,
  ])
);

module.exports = { ...base, moduleNameMapper };
