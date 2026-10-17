import { useEffect, useState } from 'react';

export default function ExportDialog({ report, nameA, nameB, onClose }: { report: string; nameA: string; nameB: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const base = (n: string) => n.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_');
  const fname = `pdf-diff_${base(nameA)}_vs_${base(nameB)}.txt`;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Export change list">
        <div className="mh"><h2>Export change list</h2><span className="tag tb">Plain text</span><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="mo"><span className="chip on">All changes</span><span className="chip on">Group by sheet</span><span className="chip on">Fold repeated</span><span className="sp" /><span>UTF-8 · LF · ≤ 80 columns</span></div>
        <div className="pre"><pre data-testid="report">{report}</pre></div>
        <div className="mf"><span>{fname} · {(new Blob([report]).size / 1024).toFixed(1)} KB</span><span className="sp" />
          <button className="btn2" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <button className="btn" onClick={download} data-testid="download">⤓ Download .txt</button>
        </div>
      </div>
    </div>
  );
}
