const rootConfig = require('../babel.config.js');

// Shared babel config for the custom/ packages: the repo-root config, with one
// deviation.
//
// The root config's `test` env lists `@babel/plugin-transform-regenerator`
// explicitly even though that env targets `node: 'current'`, where async/await and
// generators are native. Running it over these packages' sources crashes inside
// the plugin ("Cannot read properties of null (reading 'name')" from
// regenerator/emit.ts), so it is dropped here. Nothing is lost: preset-env would
// not have inserted it for the current-node target anyway.
const REMOVED_TEST_PLUGINS = ['@babel/plugin-transform-regenerator'];

const pluginName = plugin => (Array.isArray(plugin) ? plugin[0] : plugin);

module.exports = {
  ...rootConfig,
  env: {
    ...rootConfig.env,
    test: {
      ...rootConfig.env.test,
      plugins: rootConfig.env.test.plugins.filter(
        plugin => !REMOVED_TEST_PLUGINS.includes(pluginName(plugin))
      ),
    },
  },
};
