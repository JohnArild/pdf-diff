import type { LoadedDoc } from '../lib/engine';
import type { DiffResult } from '../lib/types';

interface Props { docA: LoadedDoc | null; docB: LoadedDoc | null; result: DiffResult | null; onSwap: () => void; onReset: () => void; onExport: () => void; canExport: boolean }

function Chip({ side, doc, rev }: { side: 'A' | 'B'; doc: LoadedDoc | null; rev?: string | null }) {
  return (
    <div className="file">
      <span className={`tag ${side === 'A' ? 'ta' : 'tb'}`}>{side}</span>
      <b title={doc?.data.name}>{doc ? doc.data.name : side === 'A' ? 'Rev A (old)' : 'Rev B (new)'}</b>
      {doc && <span>{rev ? `Rev ${rev} · ` : ''}{doc.data.pages.length} pages</span>}
    </div>
  );
}

export default function TopBar({ docA, docB, result, onSwap, onReset, onExport, canExport }: Props) {
  return (
    <div className="top">
      <div className="logo"><i />PDF Diff</div>
      <div className="files">
        <Chip side="A" doc={docA} rev={result?.sheetsA[0]?.rev} />
        <button className="iconbtn" title="Swap Rev A and Rev B" onClick={onSwap} disabled={!docA && !docB} data-testid="swap">⇄</button>
        <Chip side="B" doc={docB} rev={result?.sheetsB[0]?.rev} />
      </div>
      <div className="sp" />
      <div className="seg">
        <div className="on">Side by side</div>
        <div className="off" title="Coming in phase 2">Overlay</div>
        <div className="off" title="Coming in phase 2">Slider</div>
      </div>
      {(docA || docB) && <button className="btn2" onClick={onReset}>New comparison</button>}
      <button className="btn" onClick={onExport} disabled={!canExport}>Export report</button>
    </div>
  );
}
