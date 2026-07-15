/**
 * Shared babel config factory for the custom/ packages.
 *
 * The five custom packages each need their own leaf `babel.config.js` because the root
 * `babel.config.js` sets `babelrcRoots: ['./platform/*', './extensions/*', './modes/*']`
 * — which does NOT cover `custom/*` — and babel does not walk up to a project-wide
 * config. Their env (test / production / development) blocks were byte-identical; only
 * the top-level `plugins` and a couple of env-plugin extras differed, so that shared
 * shape lives here and each package passes just its deltas.
 *
 * Note: this file is intentionally NOT named `babel.config.js`, so babel does not
 * auto-detect it as a config — it is a plain module the leaf configs require().
 *
 * @param {object} [opts]
 * @param {any[]} [opts.plugins]            top-level plugins for this package
 * @param {any[]} [opts.testPlugins]        extra plugins for the `test` env
 * @param {any[]} [opts.developmentPlugins] extra plugins for the `development` env
 */
module.exports = function customBabelConfig({
  plugins = [],
  testPlugins = [],
  developmentPlugins = [],
} = {}) {
  const buildPresets = () => [
    // WebPack handles ES6 --> Target Syntax
    ['@babel/preset-env', { modules: false }],
    '@babel/preset-react',
    '@babel/preset-typescript',
  ];
  const buildIgnore = () => ['**/*.test.jsx', '**/*.test.js', '__snapshots__', '__tests__'];

  return {
    plugins,
    env: {
      test: {
        presets: [
          ['@babel/preset-env', { modules: 'commonjs', debug: false, targets: { node: 'current' } }],
          '@babel/preset-react',
          '@babel/preset-typescript',
        ],
        plugins: [
          '@babel/plugin-proposal-object-rest-spread',
          '@babel/plugin-syntax-dynamic-import',
          '@babel/plugin-transform-runtime',
          ...testPlugins,
        ],
      },
      production: {
        presets: buildPresets(),
        ignore: buildIgnore(),
      },
      development: {
        presets: buildPresets(),
        plugins: [...developmentPlugins],
        ignore: buildIgnore(),
      },
    },
  };
};
