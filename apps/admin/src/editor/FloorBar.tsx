import { useRef, useState } from 'react';
import { shortFloorLabel } from '@hwn/map-render';
import { addFloor } from './ops';
import { useEditor } from './store';

export function FloorBar() {
  const building = useEditor((s) => s.building);
  const floorId = useEditor((s) => s.floorId);
  const setFloor = useEditor((s) => s.setFloor);
  const edit = useEditor((s) => s.edit);
  const [copyStructure, setCopyStructure] = useState(true);
  const menuRef = useRef<HTMLDetailsElement>(null);
  if (!building) return null;

  const floors = [...building.floors].sort((a, b) => b.level - a.level);

  const create = (below: boolean) => {
    let id = '';
    edit((b) => {
      id = addFloor(b, {
        below,
        copyStructureFrom: copyStructure && floorId ? floorId : undefined,
      }).id;
    });
    setFloor(id);
    menuRef.current?.removeAttribute('open');
  };

  return (
    <div className="floor-bar" role="group" aria-label="Chọn tầng">
      {floors.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`floor-tab${f.id === floorId ? ' active' : ''}`}
          aria-pressed={f.id === floorId}
          title={f.name}
          onClick={() => setFloor(f.id)}
        >
          <strong>{shortFloorLabel(f)}</strong>
          <span>{f.name}</span>
        </button>
      ))}
      <details ref={menuRef} className="floor-add">
        <summary className="btn btn-sm">+ Tầng</summary>
        <div className="floor-add-menu">
          <button type="button" className="btn btn-sm" onClick={() => create(false)}>
            Thêm tầng phía trên
          </button>
          <button type="button" className="btn btn-sm" onClick={() => create(true)}>
            Thêm tầng phía dưới
          </button>
          <label className="checkbox small">
            <input
              type="checkbox"
              checked={copyStructure}
              onChange={(e) => setCopyStructure(e.target.checked)}
            />
            Sao chép tường, cửa, thang từ tầng đang xem
          </label>
        </div>
      </details>
    </div>
  );
}
