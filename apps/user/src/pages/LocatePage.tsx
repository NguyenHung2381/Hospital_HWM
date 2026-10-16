import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { LocalizeResult } from '@hwn/map-core';
import { MapViewer } from '@hwn/map-render';
import { Icon } from '../components/Icon';
import { NeedLocationLinks } from '../components/LocationCard';
import { api, errorMessage } from '../lib/api';
import { useCamera, type CameraStatus } from '../lib/camera';
import { compressImage } from '../lib/image';
import { describeLocation, locationText, safeReturnTo } from '../lib/location';
import { useActiveBuilding, useCampusContext } from '../lib/queries';
import { useNav, type LocationSource } from '../lib/store';

/** Dưới ngưỡng này thì nhắc người dùng kiểm tra lại vị trí. */
const LOW_CONFIDENCE = 0.6;

type Phase =
  | { kind: 'camera' }
  | { kind: 'uploading'; preview: string }
  | { kind: 'result'; preview: string; result: LocalizeResult; source: LocationSource }
  | { kind: 'error'; preview: string; message: string };

const CAMERA_PROBLEM: Partial<Record<CameraStatus, string>> = {
  denied:
    'Bạn đã chặn quyền dùng camera. Hãy cho phép camera trong cài đặt trình duyệt, hoặc chọn ảnh có sẵn.',
  unavailable: 'Không mở được camera trên thiết bị này.',
  insecure:
    'Trình duyệt chỉ cho dùng camera trên trang HTTPS. Bạn vẫn có thể chụp bằng ứng dụng Camera rồi chọn ảnh.',
  error: 'Có lỗi khi mở camera.',
};

function PhotoPicker({ onFile, label }: { onFile: (file: File) => void; label: string }) {
  return (
    <label className="button">
      <Icon name="image" size={18} /> {label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

export function LocatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const building = useActiveBuilding();
  const campus = useCampusContext(building.data);
  const setLocation = useNav((s) => s.setLocation);
  // Tách từng giá trị: object trả về chứa ref nên không đọc thuộc tính của nó khi render.
  const { videoRef, status: cameraStatus, start, stop, capture } = useCamera();
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });

  const localize = useMutation({
    mutationFn: (image: Blob) => api.localize(image, { buildingId: building.data?.id }),
  });

  // Chỉ bật camera khi đang ở bước chụp (tắt khi xem kết quả để tiết kiệm pin).
  const inCamera = phase.kind === 'camera';
  useEffect(() => {
    if (!inCamera) return;
    void start();
    return stop;
  }, [inCamera, start, stop]);

  // Thu hồi URL ảnh xem trước khi không dùng nữa.
  const preview = 'preview' in phase ? phase.preview : null;
  useEffect(() => (preview ? () => URL.revokeObjectURL(preview) : undefined), [preview]);

  const submit = async (image: Blob, source: LocationSource) => {
    const previewUrl = URL.createObjectURL(image);
    setPhase({ kind: 'uploading', preview: previewUrl });
    try {
      const result = await localize.mutateAsync(image);
      setPhase({ kind: 'result', preview: previewUrl, result, source });
    } catch (error) {
      setPhase({ kind: 'error', preview: previewUrl, message: errorMessage(error) });
    }
  };

  const shoot = async () => {
    const image = await capture();
    if (image) await submit(image, 'camera');
  };

  const pickFile = async (file: File) => {
    try {
      await submit(await compressImage(file), 'photo');
    } catch {
      setPhase({ kind: 'error', preview: '', message: 'Không đọc được ảnh. Hãy thử ảnh khác.' });
    }
  };

  const confirm = () => {
    if (phase.kind !== 'result') return;
    const { result, source } = phase;
    setLocation({
      buildingId: result.buildingId,
      floorId: result.floorId,
      position: result.position,
      heading: result.heading,
      confidence: result.confidence,
      source,
    });
    navigate(returnTo, { replace: true });
  };

  /* ---------------- Bước chụp ---------------- */

  if (phase.kind === 'camera') {
    const problem = CAMERA_PROBLEM[cameraStatus];
    return (
      <main className="camera">
        <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
        <div className="camera-top">
          <Link to={returnTo} className="icon-button" aria-label="Quay lại">
            <Icon name="back" />
          </Link>
          <p className="camera-hint">
            Hướng camera vào biển tên phòng, quầy hoặc hành lang gần bạn rồi bấm chụp
          </p>
        </div>

        {cameraStatus === 'starting' && <p className="camera-status">Đang mở camera…</p>}
        {problem && (
          <div className="camera-problem card">
            <p>{problem}</p>
            <PhotoPicker onFile={pickFile} label="Chụp / chọn ảnh" />
            {building.data && <NeedLocationLinks building={building.data} returnTo={returnTo} />}
          </div>
        )}

        <div className="camera-controls">
          <PhotoPicker onFile={pickFile} label="Ảnh" />
          <button
            type="button"
            className="shutter"
            aria-label="Chụp ảnh"
            disabled={cameraStatus !== 'ready'}
            onClick={() => void shoot()}
          />
          <Link to={`/locate/pick?returnTo=${encodeURIComponent(returnTo)}`} className="button">
            <Icon name="pin" size={18} /> Bản đồ
          </Link>
        </div>
      </main>
    );
  }

  /* ---------------- Đang gửi / kết quả / lỗi ---------------- */

  const result = phase.kind === 'result' ? phase.result : null;
  const description =
    result && building.data ? locationText(describeLocation(building.data, result)) : null;

  return (
    <main className="page">
      <header className="page-header">
        <button type="button" className="back-link" onClick={() => setPhase({ kind: 'camera' })}>
          ‹ Chụp lại
        </button>
        <h1>Xác định vị trí</h1>
      </header>

      {phase.preview && (
        <div className={`photo-preview${phase.kind === 'uploading' ? ' loading' : ''}`}>
          <img src={phase.preview} alt="Ảnh vừa chụp" />
          {phase.kind === 'uploading' && <span className="spinner" aria-label="Đang xử lý" />}
        </div>
      )}

      {phase.kind === 'uploading' && <p className="muted center-text">Đang nhận diện vị trí…</p>}

      {phase.kind === 'error' && (
        <section className="card card-warn">
          <p className="error">{phase.message}</p>
          <button
            type="button"
            className="button button-primary button-block"
            onClick={() => setPhase({ kind: 'camera' })}
          >
            <Icon name="camera" /> Chụp lại
          </button>
          {building.data && <NeedLocationLinks building={building.data} returnTo={returnTo} />}
        </section>
      )}

      {result && building.data && (
        <>
          <section className={`card${result.confidence < LOW_CONFIDENCE ? ' card-warn' : ''}`}>
            <div className="muted small">Bạn đang ở</div>
            <h2>{description}</h2>
            <div
              className="confidence"
              aria-label={`Độ tin cậy ${Math.round(result.confidence * 100)}%`}
            >
              <div className="confidence-bar">
                <span style={{ width: `${Math.round(result.confidence * 100)}%` }} />
              </div>
              <span className="muted small">Độ tin cậy {Math.round(result.confidence * 100)}%</span>
            </div>
            {result.confidence < LOW_CONFIDENCE && (
              <p className="warn">
                Hệ thống chưa chắc chắn. Hãy kiểm tra trên bản đồ, chụp lại ở chỗ có biển tên rõ
                hơn, hoặc tự chọn vị trí.
              </p>
            )}
          </section>
          <div className="map-frame map-frame-small">
            <MapViewer building={building.data} campus={campus} location={result} />
          </div>
          <div className="sticky-actions">
            <button type="button" className="button button-primary button-block" onClick={confirm}>
              Đúng, tôi đang ở đây
            </button>
            <div className="button-row">
              <button type="button" className="button" onClick={() => setPhase({ kind: 'camera' })}>
                <Icon name="camera" size={18} /> Chụp lại
              </button>
              <Link to={`/locate/pick?returnTo=${encodeURIComponent(returnTo)}`} className="button">
                <Icon name="pin" size={18} /> Tự chọn
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
