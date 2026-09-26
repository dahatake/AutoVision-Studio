import type { ReactNode } from 'react';

import fluentSystemIconsLicense from '../../../../resources/licenses/fluent-system-icons.LICENSE.txt?raw';
import fluentSystemIconsNotice from '../../../../resources/licenses/fluent-system-icons.NOTICE.txt?raw';
import owlvitNotice from '../../../../resources/licenses/owlvit-base-patch32.NOTICE.txt?raw';
import { SystemIcon } from '../../components/SystemIcon';
import { PRODUCT_VERSION } from '../../product-version';
import { settingsCategories, type SettingsCategoryId } from '../../routes';
import './SettingsPage.css';

interface SettingsPageProps {
  category: SettingsCategoryId;
  onCategoryChange: (id: SettingsCategoryId) => void;
  onBack: () => void;
  renderProject?: (visible: boolean) => ReactNode;
  renderLabels?: (visible: boolean) => ReactNode;
  renderDevice?: () => ReactNode;
  hasProject?: boolean;
  visible?: boolean;
}

const unfinishedMessages: Record<Exclude<SettingsCategoryId, 'information'>, string> = {
  project: 'Project設定の編集・保存は未実装です。',
  labels: 'ラベル定義の編集・保存は未実装です。',
  inference: '推論設定の編集・保存は未実装です。',
  device: '診断・容量確認は未実装です。',
};

export function SettingsPage({
  category, onCategoryChange, onBack, renderProject, renderLabels, renderDevice, hasProject = false, visible = true,
}: SettingsPageProps) {
  const selectedCategory = settingsCategories.find(({ id }) => id === category)!;
  const requiresProject = category === 'project' || category === 'labels' || category === 'inference';
  const projectVisible = visible && hasProject && category === 'project' && renderProject !== undefined;
  const labelsVisible = visible && hasProject && category === 'labels' && renderLabels !== undefined;
  const deviceVisible = visible && category === 'device' && renderDevice !== undefined;
  const childVisible = projectVisible || deviceVisible || labelsVisible;
  const PageHeading = childVisible ? 'p' : 'h1';
  const CategoryHeading = childVisible ? 'p' : 'h2';

  return (
    <section className={`settings-page${deviceVisible ? ' settings-page--device' : ''}`} aria-labelledby="settings-heading"
      hidden={!visible} style={visible ? undefined : { display: 'none' }}>
      <header className="settings-page__header">
        <PageHeading id="settings-heading" tabIndex={-1}>
          <SystemIcon name="settings" />
          設定
        </PageHeading>
        {!childVisible && (
          <button type="button" onClick={() => onBack()}>
            <SystemIcon name="back" />
            戻る
          </button>
        )}
      </header>
      <nav className="settings-page__category-navigation" aria-label="設定カテゴリ">
        {settingsCategories.map(({ id, label }) => (
          <a
            key={id}
            id={`settings-category-${id}`}
            href={`#settings-${id}`}
            aria-current={category === id ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onCategoryChange(id);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      <section
        id={`settings-${category}`}
        className="settings-page__content"
        aria-labelledby="settings-category-heading"
      >
        {/* Keep this slot mounted: the panel removes its DOM, not its drafts, when hidden. */}
        <div hidden={!projectVisible}>{renderProject?.(projectVisible)}</div>
        <div hidden={!labelsVisible}>{renderLabels?.(labelsVisible)}</div>
        <CategoryHeading id="settings-category-heading" tabIndex={-1} hidden={deviceVisible}>{selectedCategory.label}</CategoryHeading>
        {deviceVisible && renderDevice?.()}
        {/* Selection and unfinished features are separate states, never empty saved results. */}
        {requiresProject && !hasProject && <p>Projectは選択されていません。</p>}
        {category === 'information' ? (
          <>
            <p aria-label={`製品バージョン ${PRODUCT_VERSION}`}>
              バージョン {PRODUCT_VERSION}
            </p>
            <details>
              <summary>Fluent System Icons LICENSEを開く</summary>
              <pre
                className="license-text"
                tabIndex={0}
                aria-label="Fluent System Icons LICENSE"
              >
                {fluentSystemIconsLicense}
              </pre>
            </details>
            <details>
              <summary>Fluent System Icons NOTICEを開く</summary>
              <pre
                className="license-text"
                tabIndex={0}
                aria-label="Fluent System Icons NOTICE"
              >
                {fluentSystemIconsNotice}
              </pre>
            </details>
            <p>OWL-ViT base patch32 を用いる物体検出の補助候補の利用条件は「研究目的に限る」です（補助候補の機能は未実装です）。</p>
            <details>
              <summary>OWL-ViT base patch32 NOTICEを開く</summary>
              <pre
                className="license-text"
                tabIndex={0}
                aria-label="OWL-ViT base patch32 NOTICE"
              >
                {owlvitNotice}
              </pre>
            </details>
            <p>その他の第三者通知・SBOM・モデル由来の表示は未実装です。</p>
          </>
        ) : (
          !childVisible && (category !== 'device' || renderDevice === undefined) && <p>{unfinishedMessages[category]}</p>
        )}
      </section>
    </section>
  );
}