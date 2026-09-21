import type { AnnotationDraftSaveStatus } from './useAnnotationDraft';

const labels: Record<AnnotationDraftSaveStatus, string> = {
  clean: '保存済み',
  dirty: '未保存の変更があります',
  saving: '保存中',
  saved: '保存済み',
  failed: '保存失敗',
};

export interface SaveStatusProps {
  readonly status: AnnotationDraftSaveStatus;
  readonly errorMessage?: string | null;
}

export function SaveStatus({ status, errorMessage }: SaveStatusProps) {
  const message = status === 'failed' && errorMessage ? `${labels[status]}：${errorMessage}` : labels[status];
  return (
    <p role="status" aria-live="polite" data-save-status={status}>
      <strong>保存状態:</strong> {message}
    </p>
  );
}
