import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PRODUCT_VERSION } from '../product-version';
import { appRoutes } from '../routes';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('defines one unique empty route for every required screen', () => {
    expect(appRoutes.map(({ screenId }) => screenId)).toEqual([
      'UI-01',
      'UI-02',
      'UI-03',
      'UI-04',
      'UI-05',
      'UI-06',
      'UI-07',
      'UI-08',
      'UI-09',
      'UI-10',
      'UI-11',
    ]);
    expect(new Set(appRoutes.map(({ path }) => path)).size).toBe(
      appRoutes.length,
    );
  });

  it('renders semantic navigation and the first empty route', () => {
    render(<AppShell />);

    const navigation = screen.getByRole('navigation', { name: '主要画面' });
    const links = within(navigation).getAllByRole('link');

    expect(links).toHaveLength(11);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      screen.getByLabelText(`製品バージョン ${PRODUCT_VERSION}`),
    ).toHaveTextContent(`バージョン ${PRODUCT_VERSION}`);
    expect(
      screen.getByRole('heading', { level: 1, name: '初回診断' }),
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole('link', { name: '初回診断' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('switches only the empty route selected from navigation', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole('link', { name: '結果・レポート' }));

    expect(
      screen.getByRole('heading', { level: 1, name: '結果・レポート' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '結果・レポート' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: '初回診断' })).toBeNull();
  });

  it('supports native keyboard traversal and activation', async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const navigation = screen.getByRole('navigation', { name: '主要画面' });
    const links = within(navigation).getAllByRole('link');

    await user.tab();
    expect(screen.getByRole('link', { name: '本文へ移動' })).toHaveFocus();
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Project 一覧' }),
    ).toBeInTheDocument();
  });
});