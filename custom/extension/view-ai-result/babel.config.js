// Inherits the shared custom/ babel config; adds the explicit TypeScript transform +
// loose private-class-features plugins this package relies on.
module.exports = require('../../babel.config.base.js')({
  plugins: [
    ['@babel/plugin-proposal-class-properties', { loose: true }],
    '@babel/plugin-transform-typescript',
    ['@babel/plugin-proposal-private-property-in-object', { loose: true }],
    ['@babel/plugin-proposal-private-methods', { loose: true }],
  ],
  testPlugins: ['@babel/plugin-transform-typescript'],
});
