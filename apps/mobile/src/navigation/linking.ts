import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

/**
 * Optional deep links into the native shell. The web app handles its own routes inside WebView.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['goout://'],
  config: {
    screens: {
      WebApp: '',
    },
  },
};
