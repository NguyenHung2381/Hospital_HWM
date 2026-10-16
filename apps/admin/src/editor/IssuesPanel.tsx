import type { ValidationIssue } from '@hwn/map-core';
import { Panel } from './fields';

export function IssuesPanel({
  issues,
  onFocus,
}: {
  issues: readonly ValidationIssue[];
  onFocus: (issue: ValidationIssue) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <Panel title={`Kiểm tra dữ liệu (${errors} lỗi, ${issues.length - errors} cảnh báo)`}>
      {issues.length === 0 ? (
        <p className="ok small">✓ Không phát hiện vấn đề</p>
      ) : (
        <ul className="issue-list">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                className={`issue issue-${issue.severity}`}
                onClick={() => onFocus(issue)}
                title="Chuyển tới đối tượng"
              >
                <strong>{issue.severity === 'error' ? 'Lỗi' : 'Cảnh báo'}</strong> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Lỗi phải được sửa trước khi lưu. Cảnh báo không chặn việc lưu.</p>
    </Panel>
  );
}
