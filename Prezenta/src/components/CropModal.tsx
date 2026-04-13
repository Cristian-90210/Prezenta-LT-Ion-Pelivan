import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  file: File;
  onConfirm: (base64: string) => void;
  onCancel: () => void;
}

const SIZE = 280;      // dimensiunea canvas-ului de preview (px)
const OUTPUT = 200;    // dimensiunea imaginii finale salvate (px)

export default function CropModal({ file, onConfirm, onCancel }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imgRef     = useRef<HTMLImageElement | null>(null);

  const [scale,   setScale]   = useState(1);
  const [offset,  setOffset]  = useState({ x: 0, y: 0 });
  const [drag,    setDrag]    = useState<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [loaded,  setLoaded]  = useState(false);

  // Încarcă imaginea din File
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      imgRef.current = img;

      // Scale inițial: imaginea acoperă cercul
      const initScale = Math.max(SIZE / img.width, SIZE / img.height);
      setScale(initScale);
      setOffset({ x: 0, y: 0 });
      setLoaded(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Redesenează canvas-ul la fiecare schimbare
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Fundal gri
    ctx.fillStyle = 'hsl(220,14%,88%)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Desenează imaginea scalată și offsetată
    const w = img.width  * scale;
    const h = img.height * scale;
    const x = SIZE / 2 - w / 2 + offset.x;
    const y = SIZE / 2 - h / 2 + offset.y;
    ctx.drawImage(img, x, y, w, h);

    // Overlay semitransparent în afara cercului
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Contur cerc
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  }, [scale, offset]);

  useEffect(() => { if (loaded) draw(); }, [loaded, draw]);

  // Drag
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    setOffset({ x: drag.ox + e.clientX - drag.startX, y: drag.oy + e.clientY - drag.startY });
  }
  function onPointerUp() { setDrag(null); }

  // Zoom cu wheel
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setScale(s => Math.max(0.2, s - e.deltaY * 0.001));
  }

  // Generează imaginea finală (200×200 circular crop)
  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;

    const out = document.createElement('canvas');
    out.width  = OUTPUT;
    out.height = OUTPUT;
    const ctx  = out.getContext('2d')!;

    // Fundal alb
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);

    // Clip circular
    ctx.beginPath();
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
    ctx.clip();

    // Scalează offsetul de la preview (SIZE) la output (OUTPUT)
    const ratio = OUTPUT / SIZE;
    const w = img.width  * scale * ratio;
    const h = img.height * scale * ratio;
    const x = OUTPUT / 2 - w / 2 + offset.x * ratio;
    const y = OUTPUT / 2 - h / 2 + offset.y * ratio;
    ctx.drawImage(img, x, y, w, h);

    onConfirm(out.toDataURL('image/jpeg', 0.82));
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="crop-modal" onClick={e => e.stopPropagation()}>

        <div className="crop-modal-header">
          <span className="crop-modal-title">Ajustează poza</span>
          <button className="qr-zoom-close" onClick={onCancel}>✕</button>
        </div>

        <div className="crop-modal-body">
          <p className="crop-hint">Trage pentru a poziționa · Scroll sau slider pentru zoom</p>

          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className="crop-canvas"
            style={{ cursor: drag ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          />

          <div className="crop-slider-row">
            <span className="crop-slider-icon">🔍−</span>
            <input
              type="range"
              className="crop-slider"
              min={0.1}
              max={4}
              step={0.01}
              value={scale}
              onChange={e => setScale(Number(e.target.value))}
            />
            <span className="crop-slider-icon">🔍+</span>
          </div>
        </div>

        <div className="crop-modal-footer">
          <button className="btn-cancel-sm" style={{ padding: '10px 24px', fontSize: '0.9rem' }} onClick={onCancel}>
            Anulează
          </button>
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 28px' }} onClick={handleConfirm}>
            Confirmă
          </button>
        </div>
      </div>
    </div>
  );
}
