import { expect, test } from 'vite-plus/test';
import { detectPlatform } from './platform';

const agents = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

test('detects each supported certificate installation platform', () => {
  expect(detectPlatform(agents.iphone, 5)).toBe('ios');
  expect(detectPlatform(agents.android, 5)).toBe('android');
  expect(detectPlatform(agents.mac, 0)).toBe('mac');
  expect(detectPlatform(agents.windows, 0)).toBe('windows');
  expect(detectPlatform(agents.linux, 0)).toBe('other');
});

test('treats iPadOS desktop-mode Safari as iOS', () => {
  expect(detectPlatform(agents.mac, 5)).toBe('ios');
});
