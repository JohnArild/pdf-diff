import { useCallback, useEffect, useMemo, useState } from 'react';
import { compare, loadDoc, type LoadedDoc } from './lib/engine';
import { formatReport } from './lib/report';
import type { BBox, Change, DiffResult } from './lib/types';
import Upload from './components/Upload';
import TopBar from './components/TopBar';
import PageNav from './components/PageNav';
import Viewer, { type ViewState } from './components/Viewer';
import Sidebar, { type Filter } from './components/Sidebar';
import ExportDialog from './components/ExportDialog';

declare global { interface Window { __pdfdiff?: { result: DiffResult; report: string } } }

export default function App() {
  const [docA, setDocA] = useState<LoadedDoc | null>(null);
  const [docB, setDocB] = useState<LoadedDoc | null>(null);
  const [loading, setLoading] = useState<{ A?: boolean; B?: boolean }>({});
  const [result, setResult] = useState<DiffResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState(0);
  const [view, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showExport, setShowExport] = useState(false);
  const [generated, setGenerated] = useState(new Date());

  const onFile = useCallback(async (side: 'A' | 'B', f: File) => {
    setError(null); setResult(null); setLoading(l => ({ ...l, [side]: true }));
    try {
      const d = await loadDoc(f);
      (side === 'A' ? setDocA : setDocB)(d);
    } catch (e) { setError(`Could not open ${f.name}: ${String(e)}`); }
    finally { setLoading(l => ({ ...l, [side]: false })); }
  }, []);

  // compare as soon as both files are loaded
  useEffect(() => {
    if (!docA || !docB) return;
    let cancelled = false;
    setResult(null); setProgress({ done: 0, total: 1, stage: 'Starting' });
    compare(docA, docB, (done, total, stage) => !cancelled && setProgress({ done, total, stage }))
      .then(r => { if (cancelled) return; setResult(r); setPair(0); setSelected(null); setGenerated(new Date()); setProgress(null); })
      .catch(e => { if (!cancelled) { setError(String(e)); setProgress(null); } });
    return () => { cancelled = true; };
  }, [docA, docB]);

  const report = useMemo(() => result && docA && docB ? formatReport(result, {
    nameA: docA.data.name, nameB: docB.data.name, pagesA: docA.data.pages.length, pagesB: docB.data.pages.length,
    revA: result.sheetsA[0]?.rev, revB: result.sheetsB[0]?.rev, generated,
  }) : '', [result, docA, docB, generated]);

  useEffect(() => { if (result) window.__pdfdiff = { result, report }; }, [result, report]);

  const swap = () => { setDocA(docB); setDocB(docA); };
  const reset = () => { setDocA(null); setDocB(null); setResult(null); };

  const allChanges: Change[] = useMemo(() => result ? result.perPair.flatMap(p => p.changes) : [], [result]);
  const jumpTo = (c: Change) => {
    setSelected(c.id); setPair(c.pair);
    const bb = (c.bboxB ?? c.bboxA) as BBox | null;
    if (bb) setView({ zoom: -1, x: 0, y: 0, focus: bb });
    else setView({ zoom: 1, x: 0, y: 0 });
  };
  const goPair = (i: number) => { setPair(i); setView({ zoom: 1, x: 0, y: 0 }); setSelected(null); };

  const ready = docA && docB && result;
  return (
    <div className="app">
      <TopBar docA={docA} docB={docB} result={result} onSwap={swap} onReset={reset} onExport={() => setShowExport(true)} canExport={!!result} />
      {!ready ? (
        <Upload docA={docA} docB={docB} loading={loading} onFile={onFile} progress={progress} error={error} />
      ) : (
        <>
          <PageNav result={result} docA={docA} docB={docB} pair={pair} onPair={goPair} changes={allChanges} />
          <div className="main">
            <Viewer result={result} docA={docA} docB={docB} pair={pair} view={view} setView={setView} selected={selected} filter={filter} onSelect={id => setSelected(id)} />
            <Sidebar result={result} changes={allChanges} pair={pair} selected={selected} filter={filter} setFilter={setFilter} onJump={jumpTo} onExport={() => setShowExport(true)} />
          </div>
        </>
      )}
      {showExport && result && <ExportDialog report={report} nameA={docA!.data.name} nameB={docB!.data.name} onClose={() => setShowExport(false)} />}
    </div>
  );
}
