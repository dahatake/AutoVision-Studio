import { describe, expect, it } from 'vitest';

import packageMetadata from '../../package.json';

import { PRODUCT_VERSION } from './product-version';

describe('product version', () => {
  it('uses the root package version as the renderer product version', () => {
    expect(PRODUCT_VERSION).toBe(packageMetadata.version);
  });
});