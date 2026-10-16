import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { isCampusDirty, useCampusDraft } from '../site/campusDraft';
import { reloadDraft, saveAll, useSaveStatus } from './draft';
import { dirtyIds, useEditor } from './store';

/**
 * Trạng thái lưu + Hoàn tác/Làm lại/Lưu — hiện trên thanh trên cùng ở các trang sửa dữ liệu.
 * Lưu = lưu mọi toà có thay đổi lẫn mặt bằng tổng thể; Hoàn tác / Làm lại theo trang (Vẽ toà nhà /
 * Khuôn viên).
 */
export function SaveBar() {
  const queryClient = useQueryClient();
  const hasDraft = useEditor((s) => !!s.building);
  const buildingDirty = useEditor((s) => s.dirty);
  const dirtyCount = useEditor((s) => dirtyIds(s).length);
  const campusDirty = useCampusDraft(isCampusDirty);
  const { pathname } = useLocation();
  const hasCampus = useCampusDraft((s) => !!s.draft);
  const site = hasCampus && pathname.startsWith('/site');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const siteUndo = useCampusDraft((s) => s.past.length > 0);
  const siteRedo = useCampusDraft((s) => s.future.length > 0);
  const pending = useSaveStatus((s) => s.pending);
  const campusSaving = useCampusDraft((s) => s.saving);
  if (!hasDraft) return null;
  const dirty = buildingDirty || campusDirty;
  const undo = site ? useCampusDraft.getState().undo : useEditor.getState().undo;
  const redo = site ? useCampusDraft.getState().redo : useEditor.getState().redo;
  const what = [
    buildingDirty && (dirtyCount > 1 ? `${dirtyCount} toà nhà` : 'toà nhà'),
    campusDirty && 'ngoài trời',
  ]
    .filter(Boolean)
    .join(' + ');

  return (
    <div className="save-bar">
      <button
        type="button"
        className="btn btn-sm"
        disabled={site ? !siteUndo : !canUndo}
        onClick={undo}
        title={`Hoàn tác (Ctrl+Z) — ${site ? 'ngoài trời' : 'trong toà'}`}
      >
        ↶ Hoàn tác
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={site ? !siteRedo : !canRedo}
        onClick={redo}
        title={`Làm lại (Ctrl+Y) — ${site ? 'ngoài trời' : 'trong toà'}`}
      >
        ↷ Làm lại
      </button>
      <span className={`save-state${dirty ? ' dirty' : ''}`} title={what || undefined}>
        {pending || campusSaving ? 'Đang lưu…' : dirty ? `Chưa lưu (${what})` : 'Đã lưu'}
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!dirty || pending || campusSaving}
        onClick={() => void saveAll(queryClient)}
        title="Lưu mọi toà nhà có thay đổi và ngoài trời (Ctrl+S)"
      >
        Lưu
      </button>
    </div>
  );
}

export function SaveErrorAlert() {
  const queryClient = useQueryClient();
  const error = useSaveStatus((s) => s.error);
  const patch = useSaveStatus((s) => s.patch);
  const campusError = useCampusDraft((s) => s.error);
  return (
    <>
      {error && (
        <div className="editor-alert" role="alert">
          <span>{error.message}</span>
          {error.invalid && (
            <Link to="/map?tab=issues" className="btn btn-sm">
              Xem danh sách lỗi
            </Link>
          )}
          {error.conflict && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (window.confirm('Tải bản mới nhất từ máy chủ? Các thay đổi chưa lưu sẽ mất.')) {
                  void reloadDraft(queryClient);
                }
              }}
            >
              Tải bản mới nhất
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => patch({ error: null })}>
            Đóng
          </button>
        </div>
      )}
      {campusError && (
        <div className="editor-alert" role="alert">
          <span>{campusError.message}</span>
          {campusError.conflict && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (
                  window.confirm(
                    'Tải mặt bằng tổng thể mới nhất? Các thay đổi ngoài trời chưa lưu sẽ mất.',
                  )
                ) {
                  useCampusDraft.getState().clear();
                  void queryClient.invalidateQueries({ queryKey: ['campus'] });
                }
              }}
            >
              Tải bản mới nhất
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => useCampusDraft.setState({ error: null })}
          >
            Đóng
          </button>
        </div>
      )}
    </>
  );
}
