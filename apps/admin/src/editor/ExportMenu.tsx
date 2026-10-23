import { useRef, useState } from 'react';
import { downloadPng, downloadSvg, printPdf } from './exportPlan';
import { useCurrentFloor, useEditor } from './store';

/** Nút "Xuất" trên đầu trang: xuất tầng đang mở ra PNG / SVG / PDF (theo các lớp đang hiện). */
export function ExportMenu() {
  const floor = useCurrentFloor();
  const building = useEditor((s) => s.building);
  const hiddenLayers = useEditor((s) => s.settings.hiddenLayers);
  const ref = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState<string | null>(null);
  if (!floor || !building) return null;

  const run = (fn: () => void | Promise<void>) => async () => {
    ref.current?.removeAttribute('open');
    setError(null);
    try {
      await fn();
    } catch {
      setError('Xuất thất bại');
    }
  };

  return (
    <details ref={ref} className="export-menu">
      <summary className="btn btn-sm" title="Xuất mặt bằng tầng đang mở">
        Xuất ▾{error && <span className="error small"> · {error}</span>}
      </summary>
      <div className="export-menu-list" role="menu">
        <button
          type="button"
          role="menuitem"
          onClick={run(() => downloadPng(building, floor, hiddenLayers))}
        >
          Ảnh PNG <span className="muted small">50 px / m</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={run(() => downloadSvg(building, floor, hiddenLayers))}
        >
          SVG vector <span className="muted small">tỉ lệ 1:100</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={run(() => printPdf(building, floor, hiddenLayers))}
        >
          In / PDF <span className="muted small">A3, vừa trang</span>
        </button>
      </div>
    </details>
  );
}
