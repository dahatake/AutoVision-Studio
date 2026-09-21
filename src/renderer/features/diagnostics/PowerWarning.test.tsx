import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PowerWarning, type PowerWarningReading } from './PowerWarning';

const reading = (patch: Partial<PowerWarningReading>): PowerWarningReading => ({
  battery: { status: 'on-ac' }, thermal: { status: 'nominal' }, ...patch,
});

describe('CORE-14 PowerWarning', () => {
  it('warns before long work while running on battery', () => {
    render(<PowerWarning operationName="学習" reading={reading({ battery: { status: 'on-battery' } })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('バッテリー駆動です。学習の前に電源へ接続してください。');
    expect(screen.getByRole('region', { name: '電源と温度の状態' })).toHaveTextContent('バッテリー駆動');
  });

  it('warns only for the thermal states the OS actually reports as high', () => {
    const { rerender } = render(<PowerWarning reading={reading({ thermal: { status: 'serious' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('本体温度が高い状態です');

    rerender(<PowerWarning reading={reading({ thermal: { status: 'critical' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('本体温度が危険状態です');

    rerender(<PowerWarning reading={reading({ thermal: { status: 'fair' } })} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: '電源と温度の状態' })).toHaveTextContent('やや上昇');
  });

  it('shows unknown values as unknown, never as normal', () => {
    render(<PowerWarning reading={{
      battery: { status: 'unknown', reason: 'unavailable' },
      thermal: { status: 'unknown', reason: 'unsupported-platform' },
    }} />);

    const region = screen.getByRole('region', { name: '電源と温度の状態' });
    expect(region).toHaveTextContent('不明（取得できませんでした）');
    expect(region).toHaveTextContent('不明（この環境では取得できません）');
    expect(region).not.toHaveTextContent('通常');
    expect(region).not.toHaveTextContent('電源に接続');
    // Nothing was measured, so nothing may be warned about either.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a missing reading as unknown', () => {
    render(<PowerWarning reading={null} />);

    expect(screen.getByRole('region', { name: '電源と温度の状態' })).toHaveTextContent('不明');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows both warnings together when both are measured', () => {
    render(<PowerWarning reading={{ battery: { status: 'on-battery' }, thermal: { status: 'critical' } }} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('バッテリー駆動です。長時間の処理の前に電源へ接続してください。');
    expect(alert).toHaveTextContent('本体温度が危険状態です。長時間の処理の前に冷却を確認してください。');
  });
});
