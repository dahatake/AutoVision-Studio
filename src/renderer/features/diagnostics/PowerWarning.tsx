/** Mirrors the Main reading (CORE-14). The Renderer displays it as given and
 * never converts an unknown value into a reassuring one.
 */
export type PowerThermalUnknownReason = 'unsupported-platform' | 'unavailable';

export interface PowerWarningReading {
  readonly battery: { readonly status: 'on-battery' | 'on-ac' | 'unknown'; readonly reason?: PowerThermalUnknownReason };
  readonly thermal: {
    readonly status: 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';
    readonly reason?: PowerThermalUnknownReason;
  };
}

export interface PowerWarningProps {
  readonly reading: PowerThermalReadingOrMissing;
  /** Named in the message so the user knows which long operation is at risk. */
  readonly operationName?: string;
}

export type PowerThermalReadingOrMissing = PowerWarningReading | null;

const unknownText: Readonly<Record<PowerThermalUnknownReason | 'none', string>> = Object.freeze({
  'unsupported-platform': 'この環境では取得できません',
  unavailable: '取得できませんでした',
  none: '取得できませんでした',
});

const thermalText: Readonly<Record<'nominal' | 'fair' | 'serious' | 'critical', string>> = Object.freeze({
  nominal: '通常', fair: 'やや上昇', serious: '高い', critical: '危険',
});

export function PowerWarning({ reading, operationName = '長時間の処理' }: PowerWarningProps) {
  if (reading === null) {
    return <section aria-label="電源と温度の状態">
      <p>電源と温度の状態: {unknownText.none}（不明）</p>
    </section>;
  }
  const { battery, thermal } = reading;
  const warnings: string[] = [];
  if (battery.status === 'on-battery') {
    warnings.push(`バッテリー駆動です。${operationName}の前に電源へ接続してください。`);
  }
  if (thermal.status === 'serious' || thermal.status === 'critical') {
    warnings.push(`本体温度が${thermalText[thermal.status]}状態です。${operationName}の前に冷却を確認してください。`);
  }
  return (
    <section aria-label="電源と温度の状態">
      {warnings.length > 0 && (
        <div role="alert">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      )}
      <dl>
        <dt>電源</dt>
        <dd>{battery.status === 'on-battery' ? 'バッテリー駆動'
          : battery.status === 'on-ac' ? '電源に接続'
            : `不明（${unknownText[battery.reason ?? 'none']}）`}</dd>
        <dt>本体温度</dt>
        <dd>{thermal.status === 'unknown'
          ? `不明（${unknownText[thermal.reason ?? 'none']}）`
          : thermalText[thermal.status]}</dd>
      </dl>
    </section>
  );
}
