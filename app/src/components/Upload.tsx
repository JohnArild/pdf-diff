import { useRef, useState } from 'react';
import type { LoadedDoc } from '../lib/engine';

interface Props {
  docA: LoadedDoc | null; docB: LoadedDoc | null;
  loading: { A?: boolean; B?: boolean };
  onFile: (side: 'A' | 'B', f: File) => void;
  progress: { done: number; total: number; stage: string } | null;
  error: string | null;
}

function Drop({ side, doc, busy, onFile }: { side: 'A' | 'B'; doc: LoadedDoc | null; busy?: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={`drop ${over ? 'over' : ''} ${doc ? 'filled' : ''}`} data-testid={`drop-${side.toLowerCase()}`}
      onClick={() => input.current?.click()}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid={`file-${side.toLowerCase()}`}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <span className={`tag ${side === 'A' ? 'ta' : 'tb'} big`}>{side}</span>
      <h3>{side === 'A' ? 'Rev A (old)' : 'Rev B (new)'}</h3>
      {busy ? <p className="muted">Reading PDF…</p> : doc ? (
        <>
          <p className="fname">{doc.data.name}</p>
          <p className="muted">{doc.data.pages.length} page{doc.data.pages.length === 1 ? '' : 's'} · click to replace</p>
        </>
      ) : (
        <>
          <p>Drop a PDF here</p>
          <p className="muted">or click to choose a file</p>
        </>
      )}
    </div>
  );
}

export default function Upload({ docA, docB, loading, onFile, progress, error }: Props) {
  return (
    <div className="upload">
      <div className="upload-inner">
        <h1>Compare two revisions of a PDF</h1>
        <p className="muted lead">Text and graphics differences are highlighted side by side. Files are processed locally in your browser and never uploaded.</p>
        <div className="drops">
          <Drop side="A" doc={docA} busy={loading.A} onFile={f => onFile('A', f)} />
          <div className="drop-arrow">→</div>
          <Drop side="B" doc={docB} busy={loading.B} onFile={f => onFile('B', f)} />
        </div>
        {progress && (
          <div className="progress" data-testid="progress">
            <div className="bar"><div style={{ width: `${Math.round(100 * progress.done / Math.max(1, progress.total))}%` }} /></div>
            <span>{progress.stage} {progress.total > 1 ? `· ${progress.done}/${progress.total}` : ''}</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="hints">
          <li><b>Pairing</b> by title-block sheet number (e.g. 2/26), otherwise by page order</li>
          <li><b>Text</b> word diff with character refinement · <b>Graphics</b> pixel diff (vector diff in phase 2)</li>
          <li><b>Export</b> the change list as plain text</li>
        </ul>
      </div>
    </div>
  );
}
