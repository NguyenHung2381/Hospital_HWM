import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TOOL_GROUPS } from './tools';
import { useTransient } from './transient';

type HelpTab = 'keys' | 'tools' | 'workflow';

const TABS: { id: HelpTab; label: string }[] = [
  { id: 'keys', label: 'Phím tắt' },
  { id: 'tools', label: 'Công cụ' },
  { id: 'workflow', label: 'Quy trình vẽ' },
];

/** Tổ hợp phím: "Ctrl+Shift+Z" → các nút <kbd>; "A / B" → hai lựa chọn. */
function Keys({ combo }: { combo: string }) {
  return (
    <span className="help-keys">
      {combo.split(' / ').map((alt, i) => (
        <span key={i} className="help-combo">
          {i > 0 && <span className="help-or">hoặc</span>}
          {alt.split('+').map((k, j) => (
            <kbd key={j}>{k}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

const SHORTCUT_GROUPS: { title: string; items: [string, ReactNode][] }[] = [
  {
    title: 'Khi đang vẽ (tường, phòng, đồ thị)',
    items: [
      ['Enter / Double-click', 'Kết thúc chuỗi (phòng: khép đa giác)'],
      ['Esc', 'Huỷ thao tác đang vẽ / đang kéo'],
      ['Backspace / Ctrl+Z', 'Bỏ điểm vừa đặt (tường vừa tạo cũng bị gỡ)'],
      ['0-9 rồi Enter', 'Gõ chiều dài (m) để đặt điểm tiếp theo theo hướng con trỏ, vd. 3.5'],
      ['Shift (giữ)', 'Bật/tắt tạm khoá góc 45° · Tường chữ nhật: vẽ hình vuông'],
      ['Alt (giữ)', 'Tạm tắt mọi bắt dính (lưới, góc, đầu mút)'],
    ],
  },
  {
    title: 'Chọn & chỉnh sửa',
    items: [
      ['Click / Shift+Click', 'Chọn / chọn thêm hoặc bỏ chọn'],
      ['Kéo chỗ trống →', 'Chọn các đối tượng nằm gọn trong khung'],
      ['Kéo chỗ trống ←', 'Chọn các đối tượng chạm vào khung'],
      ['Ctrl+A', 'Chọn tất cả trên tầng'],
      ['Delete / Backspace', 'Xoá đối tượng đang chọn'],
      ['Ctrl+C / Ctrl+V', 'Sao chép / dán (dán sang tầng khác giữ nguyên vị trí)'],
      ['Ctrl+D', 'Nhân bản'],
      [
        'Mũi tên / Shift+Mũi tên',
        'Đang chọn: dịch 1 ô / 10 ô lưới · không chọn gì: di chuyển bản đồ',
      ],
      ['Shift+R', 'Xoay vùng chọn 90° theo chiều kim đồng hồ'],
      ['Shift+H / Shift+V', 'Lật ngang / lật dọc vùng chọn'],
      ['Alt (khi kéo)', 'Di chuyển tự do, không bám lưới'],
      ['Esc', 'Bỏ chọn (bấm lần nữa: về công cụ Chọn)'],
    ],
  },
  {
    title: 'Vẽ toà nhà (mỗi lần một toà)',
    items: [
      [
        'Tab tên toà (đầu trang)',
        'Đổi toà đang vẽ — không cần lưu trước, bản nháp mọi toà được giữ (• = chưa lưu)',
      ],
      [
        'Trong toà / Sảnh & dốc',
        'Lớp Sảnh & dốc (tầng trệt): sảnh, khu đón trả khách, làn đón, dốc lên sảnh của toà — đi theo toà ở trang Khuôn viên',
      ],
      ['S (lớp Sảnh & dốc)', 'Sảnh đón dựng sẵn: rê tới cửa chính (chấm xanh) rồi click'],
      ['P / A (lớp Sảnh & dốc)', 'Vẽ dốc / làn / lối đi (dốc vẽ từ chân dốc lên sảnh) · vẽ sảnh'],
    ],
  },
  {
    title: 'Khuôn viên (trang riêng)',
    items: [
      ['V', 'Chọn / di chuyển toà, đường, khu vực, cổng, điểm (bảng bên phải: nhập toạ độ, góc)'],
      ['Shift+click, Shift+kéo', 'Chọn nhiều đối tượng (kể cả toà) để dời / xoay cả nhóm'],
      ['P A G O L', 'Vẽ thêm: Đường/dốc/lối đi · Khu vực · Cổng · Điểm · Cầu nối'],
      ['R / Shift+R', 'Xoay vùng chọn 15° (toà quanh tâm toà, nhóm quanh tâm nhóm)'],
      ['Mũi tên', 'Đang chọn: dời vùng chọn 1 m (Shift: 10 m) · không chọn gì: di chuyển bản đồ'],
      ['Double-click vào toà', 'Mở trang Vẽ toà nhà ở toà đó'],
      [
        'Chấm cam ở chân dốc',
        'Đầu nối của toà chưa có đường tới — vẽ đường từ đó (tự bắt dính) hoặc bấm "Nối"',
      ],
      ['Kéo toà gần đường', 'Chân dốc tự hút vào làn xe gần nhất (Alt: không hút)'],
    ],
  },
  {
    title: 'Lịch sử & lưu',
    items: [
      ['Ctrl+Z', 'Hoàn tác (trang Vẽ toà nhà: các toà · trang Khuôn viên: ngoài trời)'],
      ['Ctrl+Y / Ctrl+Shift+Z', 'Làm lại'],
      ['Ctrl+S', 'Lưu cả toà nhà và ngoài trời (dùng được cả khi đang gõ trong ô nhập)'],
    ],
  },
  {
    title: 'Khung nhìn',
    items: [
      ['Lăn chuột', 'Phóng to / thu nhỏ quanh con trỏ'],
      ['Space+Kéo / Chuột giữa', 'Kéo bản đồ'],
      ['+ / -', 'Phóng to / thu nhỏ'],
      ['Alt+Mũi tên', 'Di chuyển bản đồ kể cả khi đang chọn (Shift: nhanh hơn)'],
      ['Shift+1', 'Xem toàn bộ tầng'],
      ['Shift+2', 'Phóng tới vùng đang chọn'],
      ['G', 'Bật/tắt bắt dính theo lưới'],
    ],
  },
  {
    title: 'Khác',
    items: [['? / F1', 'Mở / đóng hướng dẫn này']],
  },
];

const WORKFLOW: { title: string; body: ReactNode }[] = [
  {
    title: 'Chuẩn bị ảnh nền',
    body: (
      <>
        Bỏ chọn mọi thứ (Esc) → bảng <b>Ảnh mặt bằng (nền)</b> bên phải → tải ảnh lên. Dùng công cụ{' '}
        <b>Hiệu chỉnh tỉ lệ (M)</b>: click 2 điểm có khoảng cách đã biết rồi nhập số mét thực tế.
      </>
    ),
  },
  {
    title: 'Vẽ tường',
    body: (
      <>
        <b>Tường (W)</b> để vẽ từng đoạn — gõ số rồi Enter để vẽ đúng chiều dài; click lại điểm đầu
        để khép kín. Phòng hình chữ nhật dùng <b>Tường chữ nhật (B)</b> cho nhanh (tự tạo phòng kèm
        theo nếu bật trong Cài đặt vẽ).
      </>
    ),
  },
  {
    title: 'Đặt cửa',
    body: (
      <>
        <b>Cửa đi (D)</b>, <b>Cửa sổ (N)</b>, <b>Cửa ra vào chính (E)</b>: rê chuột sát tường rồi
        click. Màu đỏ = chồng lên cửa khác. Chọn cửa để chỉnh độ rộng hoặc kéo trượt dọc tường.
      </>
    ),
  },
  {
    title: 'Tạo phòng & gán khoa',
    body: (
      <>
        <b>Tạo phòng từ vùng kín (F)</b>: click vào bên trong vùng có tường bao. Hình dạng phức tạp
        thì dùng <b>Vẽ phòng (R)</b>. Chọn phòng để đặt tên, mã và khoa ở bảng Thuộc tính.
      </>
    ),
  },
  {
    title: 'Thang & nối tầng',
    body: (
      <>
        Đặt <b>Thang máy (L)</b>, <b>Thang bộ (S)</b>, <b>Thang cuốn (K)</b>, rồi chọn thang và bấm
        các nút “Đặt cùng thang này ở tầng khác” để các tầng dùng chung một giếng thang.
      </>
    ),
  },
  {
    title: 'Đồ thị đi lại',
    body: (
      <>
        Bấm “Tự sinh” ở bảng <b>Đồ thị đi lại</b> (khi không chọn gì), sau đó chỉnh tay bằng{' '}
        <b>Điểm (P)</b> và <b>Nối (J)</b> ở các hành lang phức tạp.
      </>
    ),
  },
  {
    title: 'Kiểm tra & lưu',
    body: (
      <>
        Xem tab <b>Kiểm tra</b> để sửa lỗi, thử tuyến ở tab <b>Thử chỉ đường</b>, cuối cùng{' '}
        <kbd>Ctrl</kbd>+<kbd>S</kbd> để lưu.
      </>
    ),
  },
];

/** Hộp thoại hướng dẫn của trình vẽ bản đồ (mở bằng nút "Hướng dẫn", phím ? hoặc F1). */
export function HelpDialog() {
  const open = useTransient((s) => s.helpOpen);
  const patch = useTransient((s) => s.patch);
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<HelpTab>('keys');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="help-dialog"
      aria-labelledby="help-title"
      onClose={() => patch({ helpOpen: false })}
      onClick={(e) => {
        // Click ra ngoài khung (vào nền mờ) thì đóng.
        if (e.target === e.currentTarget) patch({ helpOpen: false });
      }}
      onKeyDown={(e) => {
        if (e.key === '?' || e.key === 'F1' || (e.shiftKey && e.code === 'Slash')) {
          e.preventDefault();
          patch({ helpOpen: false });
        }
      }}
    >
      <div className="help-inner">
        <header className="help-header">
          <h2 id="help-title">Hướng dẫn vẽ bản đồ</h2>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Đóng"
            onClick={() => patch({ helpOpen: false })}
          >
            ✕
          </button>
        </header>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="help-body">
          {tab === 'keys' && (
            <div className="help-columns">
              <section>
                <h3>Chọn công cụ</h3>
                <table className="help-table">
                  <tbody>
                    {TOOL_GROUPS.flat().map((t) => (
                      <tr key={t.tool}>
                        <td>
                          <Keys combo={t.key} />
                        </td>
                        <td>{t.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {SHORTCUT_GROUPS.map((g) => (
                <section key={g.title}>
                  <h3>{g.title}</h3>
                  <table className="help-table">
                    <tbody>
                      {g.items.map(([combo, desc]) => (
                        <tr key={combo}>
                          <td>
                            <Keys combo={combo} />
                          </td>
                          <td>{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}

          {tab === 'tools' && (
            <ul className="help-tools">
              {TOOL_GROUPS.flat().map((t) => (
                <li key={t.tool}>
                  <span className="help-tool-icon">{t.icon}</span>
                  <div>
                    <strong>
                      {t.label} <Keys combo={t.key} />
                    </strong>
                    <p>{t.hint}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {tab === 'workflow' && (
            <ol className="help-steps">
              {WORKFLOW.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </dialog>
  );
}
