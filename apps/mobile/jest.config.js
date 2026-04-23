module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // React Navigation ships ESM; transpile these packages under Jest.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|react-native-windows|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-gesture-handler|react-native-webview)/)',
  ],
};
