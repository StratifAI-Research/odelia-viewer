// Inherits the shared custom/ babel config; SVG handled at the babel level via
// inline-react-svg (this package has no webpack @svgr loader, by design).
module.exports = require('../../babel.config.base.js')({
  plugins: ['inline-react-svg', '@babel/plugin-proposal-class-properties'],
  developmentPlugins: ['react-hot-loader/babel'],
});
