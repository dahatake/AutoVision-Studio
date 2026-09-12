import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { SystemIcon, type SystemIconName } from './SystemIcon';

// Path lengths and verbatim boundaries from Fluent System Icons commit
// 5bae3fb7771054c252a54b1d9210e9c03439fa1b (docs/dependency-adoption/ui-icons.md).
// These local regression checks do not replace a complete upstream comparison.
const iconCases = [
  {
    name: 'projects',
    label: 'Project一覧',
    pathLength: 517,
    prefix: 'M4.5 3C3.11929 3 2 4.11929 2 5.5',
    suffix: 'C3.67157 16 3 15.3284 3 14.5V8Z',
  },
  {
    name: 'import',
    label: '取り込む',
    pathLength: 1091,
    prefix: 'M3.00026 5.5V12.1041L4.50091 9.50488',
    suffix: 'C2.00031 14.5586 1.99955 14.5097 2.00026 14.4607Z',
  },
  {
    name: 'annotations',
    label: '教師データ',
    pathLength: 1374,
    prefix: 'M13.9988 7.4995C13.9988 8.32784',
    suffix: 'L10.401 16.3964C10.4976 16.0101 10.6973 15.6574 10.9789 15.3758Z',
  },
  {
    name: 'training',
    label: '学習',
    pathLength: 360,
    prefix: 'M17.2204 8.68703C18.2558 9.25661',
    suffix: 'C6 15.8792 6.4079 16.12 6.74114 15.9367L16.7381 10.4377Z',
  },
  {
    name: 'reports',
    label: '結果',
    pathLength: 969,
    prefix: 'M15.5 4C14.6716 4 14 4.67157 14 5.5',
    suffix: 'C3.67157 13 3 13.6716 3 14.5Z',
  },
  {
    name: 'camera',
    label: 'カメラで試す',
    pathLength: 1124,
    prefix: 'M10.0002 6.00003C7.79104 6.00003',
    suffix: 'C6.69169 4.9994 6.86455 4.89281 6.94943 4.72392L7.67736 3.27548Z',
  },
  {
    name: 'settings',
    label: '設定',
    pathLength: 3183,
    prefix: 'M1.91099 7.38266C2.28028 6.24053',
    suffix: 'C9.17183 8.5 8.50026 9.17157 8.50026 10Z',
  },
  {
    name: 'back',
    label: '戻る',
    pathLength: 575,
    prefix: 'M9.15898 16.8666C9.36292 17.0528',
    suffix: 'L9.15898 16.8666Z',
  },
] as const satisfies readonly {
  name: SystemIconName;
  label: string;
  pathLength: number;
  prefix: string;
  suffix: string;
}[];

describe('SystemIcon', () => {
  it.each(iconCases)(
    'renders $name as one local 20px monochrome path with pinned geometry boundaries',
    ({ name, pathLength, prefix, suffix }) => {
      const { container } = render(<SystemIcon name={name} />);
      const svg = container.querySelector('svg')!;

      expect(container.children).toHaveLength(1);
      expect(svg).toBeInTheDocument();
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg).toHaveAttribute('width', '20');
      expect(svg).toHaveAttribute('height', '20');
      expect(svg).toHaveAttribute('viewBox', '0 0 20 20');
      expect(svg).toHaveAttribute('fill', 'none');
      expect(svg).toHaveAttribute('class', 'system-icon');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');

      // An exact element/attribute allowlist also rejects external references,
      // event attributes, focus targets, titles, styles and embedded content.
      expect(svg.getAttributeNames().sort()).toEqual([
        'aria-hidden',
        'class',
        'fill',
        'focusable',
        'height',
        'viewBox',
        'width',
      ]);
      expect(svg.querySelectorAll('*')).toHaveLength(1);
      expect(svg.textContent).toBe('');

      const path = svg.querySelector('path')!;
      expect(path).toBeInTheDocument();
      expect(path.getAttributeNames().sort()).toEqual(['d', 'fill']);
      expect(path).toHaveAttribute('fill', 'currentColor');

      const d = path.getAttribute('d')!;
      expect(d).toHaveLength(pathLength);
      expect(d.startsWith(prefix)).toBe(true);
      expect(d.endsWith(suffix)).toBe(true);
      expect(d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/);
    },
  );

  it.each(iconCases)(
    'keeps repeated $name icons unnamed and outside keyboard traversal',
    async ({ name, label }) => {
      const user = userEvent.setup();
      const { container } = render(
        <>
          <button type="button"><SystemIcon name={name} />{label}</button>
          <button type="button"><SystemIcon name={name} />{label}</button>
        </>,
      );

      const buttons = screen.getAllByRole('button', { name: label });
      expect(buttons).toHaveLength(2);
      expect(screen.queryAllByRole('img')).toHaveLength(0);
      expect(container.querySelectorAll('[id]')).toHaveLength(0);
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg).not.toHaveAccessibleName();
        expect(svg).not.toHaveAttribute('role');
        expect(svg).not.toHaveAttribute('tabindex');
      }

      await user.tab();
      expect(buttons[0]).toHaveFocus();
      await user.tab();
      expect(buttons[1]).toHaveFocus();
      await user.tab();
      expect(document.body).toHaveFocus();
    },
  );

  it('limits the public API to eight names and renders eight distinct paths', () => {
    expectTypeOf<SystemIconName>().toEqualTypeOf<(typeof iconCases)[number]['name']>();
    expectTypeOf<Parameters<typeof SystemIcon>[0]>().toEqualTypeOf<{
      name: SystemIconName;
    }>();

    const { container } = render(
      <>{iconCases.map(({ name }) => <SystemIcon key={name} name={name} />)}</>,
    );
    const paths = Array.from(container.querySelectorAll('path'), (path) => path.getAttribute('d'));

    expect(container.querySelectorAll('svg')).toHaveLength(8);
    expect(paths).toHaveLength(8);
    expect(new Set(paths).size).toBe(8);
  });

  it('updates the geometry when the name changes without replacing the SVG', () => {
    const { container, rerender } = render(<SystemIcon name="projects" />);
    const svg = container.querySelector('svg')!;

    for (const { name, prefix, suffix } of iconCases) {
      rerender(<SystemIcon name={name} />);

      expect(container.querySelector('svg')).toBe(svg);
      const d = svg.querySelector('path')!.getAttribute('d')!;
      expect(d.startsWith(prefix)).toBe(true);
      expect(d.endsWith(suffix)).toBe(true);
    }
  });

  it('does not forward extra runtime SVG attributes or event callbacks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const extraProps = {
      name: 'settings' as const,
      width: 99,
      height: 99,
      viewBox: '0 0 99 99',
      className: 'unexpected-icon',
      fill: 'red',
      focusable: 'true',
      tabIndex: 0,
      'aria-hidden': false,
      'aria-label': 'Unexpected icon label',
      href: 'https://example.invalid/icon.svg',
      onClick,
    };
    const { container } = render(<SystemIcon {...extraProps} />);
    const svg = container.querySelector('svg')!;

    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('viewBox', '0 0 20 20');
    expect(svg).toHaveAttribute('class', 'system-icon');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('href');
    expect(svg).not.toHaveAttribute('tabindex');
    expect(svg).not.toHaveAttribute('aria-label');
    expect(svg).not.toHaveAccessibleName();

    await user.click(svg);
    expect(onClick).not.toHaveBeenCalled();
  });
});