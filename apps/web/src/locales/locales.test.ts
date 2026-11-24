import { expect, test } from 'vite-plus/test';
import bn from './bn.json';
import en from './en.json';

function translationKeys(resource: object): string[] {
  return Object.entries(resource)
    .flatMap(([key, value]) =>
      typeof value === 'object' && value !== null
        ? translationKeys(value).map((child) => key + '.' + child)
        : [key],
    )
    .sort();
}

test('Bengali and English provide the same translation keys', () => {
  expect(translationKeys(bn)).toEqual(translationKeys(en));
});
