import { useEffect, useState } from 'react';
import { renderPage, type LoadedDoc } from '../lib/engine';
import type { Change, DiffResult } from '../lib/types';

interface Props { result: DiffResult; docA: LoadedDoc; docB: LoadedDoc; pair: number; onPair: (i: number) => void; changes: Change[] }

export default function PageNav({ result, docA, docB, pair, onPair, changes }: Props) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < result.pairs.length && !stop; i++) {
        const p = result.pairs[i];
        const [doc, idx] = p.b !== null ? [docB, p.b] : [docA, p.a as number];
        const pg = doc.data.pages[idx];
        const c = await renderPage(doc.pdf, idx, 40 / pg.height);
        if (!stop) setThumbs(t => ({ ...t, [i]: c.toDataURL() }));
      }
    })();
    return () => { stop = true; };
  }, [result, docA, docB]);
  const p = result.pairs[pair];
  const counts = result.pairs.map((_, i) => changes.filter(c => c.pair === i && !c.foldKey).length);
  const byS = result.pairs.some(x => x.by === 'sheet');
  return (
    <div className="bar">
      <div className="pn">
        <button className="b" onClick={() => onPair(Math.max(0, pair - 1))} disabled={pair === 0} aria-label="Previous sheet">‹</button>
        <div className="cur" data-testid="current-pair">{p.label}{p.by === 'sheet' ? '' : <span className="muted"> · {pair + 1}/{result.pairs.length}</span>}</div>
        <button className="b" onClick={() => onPair(Math.min(result.pairs.length - 1, pair + 1))} disabled={pair === result.pairs.length - 1} aria-label="Next sheet">›</button>
      </div>
      <div className="thumbs" data-testid="thumbs">
        {result.pairs.map((q, i) => (
          <button key={i} className={`th ${i === pair ? 'on' : ''} ${q.a === null ? 'ins' : ''} ${q.b === null ? 'del' : ''}`} onClick={() => onPair(i)}
            title={`${q.label}: Rev A p.${q.a !== null ? q.a + 1 : '–'} ↔ Rev B p.${q.b !== null ? q.b + 1 : '–'}${counts[i] ? ` · ${counts[i]} change(s)` : ''}`}>
            {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span className="ph" />}
            <span className="tl">{q.key.startsWith('#') ? q.label.replace(/^(Sheet|Page) /, '') : q.key}</span>
            {counts[i] > 0 && <span className="dotc" />}
          </button>
        ))}
      </div>
      <div className="vsep" />
      <span className="pairinfo">A p.{p.a !== null ? p.a + 1 : '–'} ↔ B p.{p.b !== null ? p.b + 1 : '–'} · paired by {byS ? 'sheet number' : 'page order'}</span>
    </div>
  );
}
