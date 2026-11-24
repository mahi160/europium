import { expect, test } from 'vite-plus/test';
import bn from './bn.json';
import en from './en.json';
test('Bengali and English cover the same application and error keys', () => {
  expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  expect(Object.keys(bn.errors).sort()).toEqual(Object.keys(en.errors).sort());
  for (const value of [...Object.values(bn), ...Object.values(bn.errors)])
    expect(value).toBeTruthy();
});
