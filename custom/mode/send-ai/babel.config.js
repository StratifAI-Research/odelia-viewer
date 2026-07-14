// Inherits the shared custom/ babel config with only the class-properties plugin.
module.exports = require('../../babel.config.base.js')({
  plugins: ['@babel/plugin-proposal-class-properties'],
});
