const path = require('path');

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['module:react-native-dotenv', {
      moduleName: '@env',
      // Resolve from this config file directory to avoid cwd-dependent lookup.
      path: path.resolve(__dirname, '../.env.local'),
      allowUndefined: true,
    }],
  ],
};
