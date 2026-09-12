import { describe, expect, it } from 'vitest';

import tokensCss from './tokens.css?raw';
import globalCss from './global.css?raw';

type Scheme = 'light' | 'dark';
type Declarations = Record<string, string>;
type Color = readonly [number, number, number, number];

// The palette is a contract; contrast tests use values read from production CSS.
const palette = {
  '--cp-bg': ['#f7f4ef', '#3d3b3a'],
  '--cp-bg-elevated': ['#fcfbf8', '#343231'],
  '--cp-surface': ['#ffffff', '#292929'],
  '--cp-surface-soft': ['#f5f5f5', '#2e2e2e'],
  '--cp-border': ['#dedede', '#474747'],
  '--cp-border-strong': ['#919191', '#5f5f5f'],
  '--cp-text': ['#242424', '#dedede'],
  '--cp-text-muted': ['#5c5c5c', '#919191'],
  '--cp-text-soft': ['#6f6f6f', '#b0b0b0'],
  '--cp-accent': ['#b11f4b', '#fd8ea1'],
  '--cp-accent-hover': ['#9a1a41', '#fb7b91'],
  '--cp-accent-soft': ['rgba(177, 31, 75, 0.08)', 'rgba(253, 142, 161, 0.14)'],
  '--cp-accent-fg': ['#ffffff', '#1a1a1a'],
  '--cp-success': ['#16a34a', '#4ade80'],
  '--cp-danger': ['#dc2626', '#f87171'],
  '--cp-warning': ['#f59e0b', '#fbbf24'],
  '--cp-link': ['#0078d4', '#4da6ff'],
  '--cp-shadow': ['0 18px 48px rgba(0, 0, 0, 0.12)', '0 18px 48px rgba(0, 0, 0, 0.32)'],
  '--cp-overlay': ['rgba(255, 255, 255, 0.8)', 'rgba(41, 41, 41, 0.88)'],
  '--cp-panel': ['rgba(255, 255, 255, 0.86)', 'rgba(41, 41, 41, 0.72)'],
  '--cp-panel-strong': ['rgba(255, 255, 255, 0.96)', 'rgba(41, 41, 41, 0.96)'],
  '--cp-sheen': ['rgba(255, 255, 255, 0.55)', 'rgba(255, 255, 255, 0.04)'],
  '--cp-highlight': ['rgba(177, 31, 75, 0.12)', 'rgba(253, 142, 161, 0.12)'],
} as const;

const legacyAliases = {
  '--color-canvas': 'var(--cp-bg)',
  '--color-surface': 'var(--cp-surface)',
  '--color-text': 'var(--cp-text)',
  '--color-text-muted': 'var(--cp-text-muted)',
  '--color-border': 'var(--cp-border)',
  '--color-accent': 'var(--cp-accent)',
  '--color-accent-hover': 'var(--cp-accent-hover)',
  '--color-on-accent': 'var(--cp-accent-fg)',
  '--color-navigation-active': 'var(--cp-accent-soft)',
  '--color-navigation-active-text': 'var(--cp-accent)',
  '--color-focus-ring': 'var(--cp-accent)',
};

function parseRules(source: string): CSSRule[] {
  const style = document.createElement('style');
  style.textContent = source;
  document.head.append(style);
  try {
    if (!style.sheet) throw new Error('Stylesheet was not parsed');
    return Array.from(style.sheet.cssRules);
  } finally {
    style.remove();
  }
}

const tokenRules = parseRules(tokensCss);
// Resolve the local import ourselves, without asking JSDOM to fetch a stylesheet.
const globalRules = parseRules(
  globalCss.replace(/^@import\s+(['"])\.\/tokens\.css\1\s*;/, ''),
);

function declarations(rule: CSSStyleRule): Declarations {
  const { style } = rule;
  return Object.fromEntries(
    Array.from({ length: style.length }, (_, index) => {
      const name = style[index];
      // The simple media merge must not silently ignore cascade priorities.
      expect(style.getPropertyPriority(name), name).toBe('');
      return [name, style.getPropertyValue(name).trim()];
    }),
  );
}

function themeFor(scheme: Scheme): Declarations {
  // JSDOM does not evaluate OS media queries. Verify scope and order before
  // applying the real dark declarations, rather than collecting every :root.
  expect(tokenRules.map(({ type }) => type)).toEqual([
    CSSRule.STYLE_RULE, CSSRule.MEDIA_RULE,
  ]);
  const light = tokenRules[0] as CSSStyleRule;
  const media = tokenRules[1] as CSSMediaRule;
  expect(light.selectorText).toBe(':root');
  expect(media.media.mediaText).toBe('(prefers-color-scheme: dark)');
  expect(media.cssRules).toHaveLength(1);
  const dark = media.cssRules[0] as CSSStyleRule;
  expect(dark.type).toBe(CSSRule.STYLE_RULE);
  expect(dark.selectorText).toBe(':root');
  return scheme === 'dark'
    ? { ...declarations(light), ...declarations(dark) }
    : declarations(light);
}

function resolveValue(value: string, theme: Declarations): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    if (theme[name] === undefined) throw new Error(`Undefined CSS token: ${name}`);
    return resolveValue(theme[name], theme);
  });
}

function token(theme: Declarations, name: string): string {
  return resolveValue(`var(${name})`, theme);
}

function ruleValue(selector: string, property: string): string {
  const rule = globalRules.find((candidate) =>
    candidate.type === CSSRule.STYLE_RULE
    && (candidate as CSSStyleRule).selectorText === selector,
  ) as CSSStyleRule | undefined;
  const value = rule?.style.getPropertyValue(property).trim();
  if (!value) throw new Error(`Missing global.css declaration: ${selector} / ${property}`);
  return value;
}

function color(value: string): Color {
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      1,
    ];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0(?:\.\d+)?|1)\)$/.exec(value);
  if (!rgba) throw new Error(`Unsupported color: ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
}

function ruleColor(theme: Declarations, selector: string, property: string): Color {
  return color(resolveValue(ruleValue(selector, property), theme));
}

function composite(foreground: Color, background: Color): Color {
  if (background[3] !== 1) throw new Error('An opaque backdrop is required');
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function luminance([red, green, blue]: Color): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: Color, background: Color): number {
  if (foreground[3] !== 1 || background[3] !== 1) {
    throw new Error('Composite translucent colors before calculating contrast');
  }
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const backgrounds = ['--color-canvas', '--color-surface', '--cp-bg-elevated'];
const activeLink = ".app-shell__navigation-link[aria-current='page']";
const focusSelector = ':where(a, button, input, select, textarea, [tabindex]):focus-visible';

function activeBackground(theme: Declarations): Color {
  return composite(
    ruleColor(theme, activeLink, 'background'),
    ruleColor(theme, '.app-shell__navigation', 'background'),
  );
}

describe('UIR-010 / FR-UI-009 color tokens', () => {
  it('uses a light fallback and only an OS dark override, without external assets', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = themeFor(scheme);
      expect(theme['color-scheme']).toBe(scheme);
      expect(Object.keys(theme).filter((name) => !name.startsWith('--'))).toEqual([
        'color-scheme',
      ]);
    }
    expect(tokensCss).not.toMatch(/@import|@font-face|url\s*\(/i);
    expect(globalCss).toMatch(/^@import\s+(['"])\.\/tokens\.css\1\s*;/);
  });

  it('uses WCAG luminance and source-over compositing without rounding', () => {
    const black = color('#000000');
    const white = color('#ffffff');
    expect(contrast(black, white)).toBe(21);
    expect(contrast(white, black)).toBe(21);
    expect(contrast(black, black)).toBe(1);
    expect(contrast(color('#777777'), white)).toBeCloseTo(4.478089, 5);
    expect(contrast(color('#777777'), white)).toBeLessThan(4.5);
    expect(contrast(color('#767676'), white)).toBeGreaterThanOrEqual(4.5);
    expect(composite(color('rgba(0, 0, 0, 0)'), white)).toEqual(white);
    expect(composite(color('rgba(255, 255, 255, 1)'), black)).toEqual(white);
    expect(composite(color('rgba(255, 255, 255, 0.5)'), black)).toEqual([
      127.5, 127.5, 127.5, 1,
    ]);
    expect(() => contrast(color('rgba(255, 255, 255, 0.5)'), black)).toThrow(
      'Composite translucent colors',
    );
  });

  it('does not use the dimmer dark palette entries as body or hover text', () => {
    const theme = themeFor('dark');
    const canvas = color(token(theme, '--color-canvas'));
    for (const name of ['--cp-text-muted', '--cp-accent-hover']) {
      expect(contrast(color(token(theme, name)), canvas), name).toBeLessThan(4.5);
    }
    expect(theme['--color-text-muted']).toBe('var(--cp-text-soft)');
    expect(theme['--color-accent-hover']).toBe('var(--cp-accent)');
  });

  describe.each(['light', 'dark'] as const)('%s', (scheme) => {
    it('keeps every Clawpilot palette value exact', () => {
      const theme = themeFor(scheme);
      const actual = Object.fromEntries(
        Object.entries(theme).filter(([name]) => name.startsWith('--cp-')),
      );
      const expected = Object.fromEntries(
        // CSSOM removes spaces after function-argument commas.
        Object.entries(palette).map(([name, values]) => [
          name, values[scheme === 'dark' ? 1 : 0].replace(/,\s*/g, ','),
        ]),
      );
      expect(actual).toEqual(expected);
    });

    it('preserves legacy aliases and resolves every token consumed by global.css', () => {
      const theme = themeFor(scheme);
      const expected = scheme === 'dark'
        ? { ...legacyAliases, '--color-text-muted': 'var(--cp-text-soft)', '--color-accent-hover': 'var(--cp-accent)' }
        : legacyAliases;
      expect(Object.fromEntries(
        Object.entries(theme).filter(([name]) => name.startsWith('--color-')),
      )).toEqual(expected);
      const references = [...globalCss.matchAll(/var\((--[\w-]+)\)/g)];
      expect(references.length).toBeGreaterThan(0);
      for (const [, name] of references) {
        expect(token(theme, name), name).not.toBe('');
      }
    });

    it('keeps body and muted text at 4.5:1 on canvas, surface and elevated backgrounds', () => {
      const theme = themeFor(scheme);
      for (const name of ['--color-text', '--color-text-muted']) {
        for (const background of backgrounds) {
          expect(
            contrast(color(token(theme, name)), color(token(theme, background))),
            `${name} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(
        ruleColor(theme, 'body', 'color'), ruleColor(theme, 'body', 'background'),
      )).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps actual link and hover text at 4.5:1 on all three backgrounds', () => {
      const theme = themeFor(scheme);
      for (const selector of ['a', 'a:hover']) {
        for (const background of backgrounds) {
          expect(
            contrast(ruleColor(theme, selector, 'color'), color(token(theme, background))),
            `${selector} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('keeps selected navigation text at 4.5:1 after blending over its actual parent', () => {
      const theme = themeFor(scheme);
      const background = ruleColor(theme, activeLink, 'background');
      expect(background[3]).toBeGreaterThan(0);
      expect(background[3]).toBeLessThan(1);
      expect(contrast(
        ruleColor(theme, activeLink, 'color'), activeBackground(theme),
      )).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the skip-link and its focused text at 4.5:1 on the accent fill', () => {
      const theme = themeFor(scheme);
      for (const selector of ['.skip-link', '.skip-link:focus']) {
        expect(contrast(
          ruleColor(theme, selector, 'color'), ruleColor(theme, '.skip-link', 'background'),
        )).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps the actual offset focus outline at 3:1 against surrounding surfaces', () => {
      const theme = themeFor(scheme);
      expect(ruleValue(focusSelector, 'outline')).toBe(
        'var(--focus-ring-width) solid var(--color-focus-ring)',
      );
      expect(token(theme, '--focus-ring-width')).toBe('0.1875rem');
      // The offset separates the accent outline from accent-filled controls.
      expect(resolveValue(ruleValue(focusSelector, 'outline-offset'), theme)).toBe('0.25rem');
      const ring = color(token(theme, '--color-focus-ring'));
      for (const background of backgrounds) {
        expect(contrast(ring, color(token(theme, background))), background).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(ring, activeBackground(theme))).toBeGreaterThanOrEqual(3);
    });

    it('uses OS fonts, a 1rem body, 10px-equivalent corners and the existing 4px spacing scale', () => {
      const theme = themeFor(scheme);
      const fonts = token(theme, '--font-family-sans').split(',').map((font) => font.trim());
      expect(fonts[0]).toBe('"Segoe UI"');
      expect(fonts).toEqual(expect.arrayContaining(['"Yu Gothic UI"', 'Meiryo']));
      expect(fonts.at(-1)).toBe('sans-serif');
      expect(token(theme, '--font-size-body')).toBe('1rem');
      expect(ruleValue('html', 'font-size')).toBe('100%');
      expect(token(theme, '--line-height-body')).toBe('1.5');
      expect(token(theme, '--radius-small')).toBe('0.625rem');
      expect(token(theme, '--border-width')).toBe('0.0625rem');
      expect(token(theme, '--navigation-inline-size')).toBe('16rem');
      expect([1, 2, 3, 4, 5, 6].map((step) => token(theme, `--space-${step}`))).toEqual([
        '0.25rem', '0.5rem', '0.75rem', '1rem', '1.5rem', '2rem',
      ]);
    });
  });
});