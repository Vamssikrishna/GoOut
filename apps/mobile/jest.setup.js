/* eslint-env jest */

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = (props) => React.createElement(View, { testID: 'webview', ...props });
  return { __esModule: true, default: WebView, WebView };
});
