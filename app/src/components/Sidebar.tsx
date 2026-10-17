import type { Change, DiffResult, FoldedChange } from '../lib/types';
import { sheetLabel } from '../lib/report';

export type Filter = 'all' | 'text' | 'graphics';

interface Props {
  result: DiffResult; changes: Change[]; pair: number; selected: string | null;
  filter: Filter; setFilter: (f: Filter) => void; onJump: (c: Change) => void; onExport: () => void;
}

const opWord = { added: 'added', removed: 'removed', modified: 'modified', moved: 'moved', resized: 'resized' } as const;
const q = (s?: string, n = 40) => (s === undefined ? '' : `"${s.length > n ? s.slice(0, n - 1) + '…' : s}"`);

function title(c: { kind: string; op: keyof typeof opWord; shape?: string }) {
  const k = c.kind === 'text' ? 'Text' : c.kind === 'graphics' ? (c.shape ?? 'Graphics') : 'Page';
  return `${k} ${opWord[c.op]}`;
}
const sg = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
function detail(c: Change | FoldedChange) {
  const ch = c as Change;
  if (c.op === 'moved' && ch.move) return `${c.kind === 'text' ? q(c.before, 16) + ' · ' : ''}dx ${sg(ch.move[0])} dy ${sg(ch.move[1])} pt`;
  if (c.op === 'resized' && ch.sizeA && ch.sizeB) {
    const r = (v: number) => Math.round(v);
    return `${r(ch.sizeA[0])}×${r(ch.sizeA[1])} → ${r(ch.sizeB[0])}×${r(ch.sizeB[1])}${ch.scale ? ` · ×${ch.scale[0].toFixed(2)} ×${ch.scale[1].toFixed(2)}` : ''}`;
  }
  if (c.kind === 'graphics' && ch.shape) { const b = (ch.bboxB ?? ch.bboxA)!; return `${Math.round(b[2] - b[0])}×${Math.round(b[3] - b[1])} pt${ch.detail ? ' · ' + ch.detail : ''}`; }
  if ('kind' in c && c.kind === 'graphics') {
    const b = (ch.bboxB ?? ch.bboxA)!;
    return `Region ${Math.round(((b[2] - b[0]) / 72) * 25.4)}×${Math.round(((b[3] - b[1]) / 72) * 25.4)} mm · ${ch.pixels ?? 0} px`;
  }
  if (c.kind === 'page') return c.op === 'added' ? 'Inserted in Rev B' : 'Deleted from Rev A';
  if (c.op === 'modified') return `${q(c.before, 18)} → ${q(c.after, 18)}`;
  return q(c.op === 'added' ? c.after : c.before);
}
const KindIcon = ({ kind }: { kind: string }) => (
  <span className="kind">{kind === 'text' ? 'T' : kind === 'page' ? 'P' : (
    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 11 L6 1 L11 11Z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>)}</span>
);

export default function Sidebar({ result, changes, pair, selected, filter, setFilter, onJump, onExport }: Props) {
  const cnt = { added: 0, removed: 0, modified: 0, moved: 0, resized: 0 };
  changes.forEach(c => cnt[c.op]++);
  const pass = (k: string) => filter === 'all' || k === filter || k === 'page';
  const rows = changes.filter(c => !c.foldKey);
  const nText = rows.filter(c => c.kind === 'text').length + result.folded.filter(f => f.kind === 'text').length;
  const nGfx = rows.filter(c => c.kind === 'graphics').length + result.folded.filter(f => f.kind === 'graphics').length;
  const label = (i: number) => sheetLabel(result.pairs[i], result.sheetsA, result.sheetsB);
  const groups = result.pairs.map((p, i) => ({ i, p, cs: rows.filter(c => c.pair === i && pass(c.kind)) })).filter(g => g.cs.length);
  const folded = result.folded.filter(f => pass(f.kind));
  return (
    <div className="side" data-testid="sidebar">
      <div className="sh">
        <h3>Changes <button className="exp" onClick={onExport} data-testid="export-list"><span>⤓ Export list</span><i>.txt ▾</i></button></h3>
        <div className="stats">
          <div className="st add"><b data-testid="count-added">{cnt.added}</b><span>Added</span></div>
          <div className="st rem"><b data-testid="count-removed">{cnt.removed}</b><span>Removed</span></div>
          <div className="st mod"><b data-testid="count-modified">{cnt.modified}</b><span>Modified</span></div>
          <div className="st mov"><b data-testid="count-moved">{cnt.moved + cnt.resized}</b><span title="Moved or resized">Moved</span></div>
        </div>
      </div>
      <div className="filters">
        {(['all', 'text', 'graphics'] as Filter[]).map(f => (
          <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'text' ? 'Text' : 'Graphics'} <em>{f === 'all' ? rows.length + result.folded.length : f === 'text' ? nText : nGfx}</em>
          </button>
        ))}
      </div>
      <div className="list" data-testid="change-list">
        {!groups.length && !folded.length && <div className="empty">No differences found{filter !== 'all' ? ' for this filter' : ''}.</div>}
        {folded.length > 0 && (
          <>
            <div className="grp"><span>Repeated on many sheets</span><span>{folded.length}</span></div>
            {folded.map(f => {
              const member = changes.find(c => f.members.includes(c.id) && c.pair === pair) ?? changes.find(c => c.id === f.members[0])!;
              return (
                <div key={f.key} className={`row ${member && selected === member.id ? 'sel' : ''}`} onClick={() => onJump(member)} data-testid="folded-row">
                  <span className={`dot ${f.op}`} />
                  <div className="rb"><div className="rt"><KindIcon kind={f.kind} />{title(f)}</div><div className="rd">{detail(f)}</div></div>
                  <span className="pg">{f.pairs.length === result.pairs.length ? 'All' : f.pairs.length} sheets</span>
                </div>
              );
            })}
          </>
        )}
        {groups.map(g => (
          <div key={g.i}>
            <div className={`grp ${g.i === pair ? 'cur' : ''}`}><span>{label(g.i)}{(g.p.b !== null ? result.sheetsB[g.p.b]?.dwg : null) ? ` · ${result.sheetsB[g.p.b!]!.dwg}` : ''}</span><span>{g.cs.length}</span></div>
            {g.cs.map(c => (
              <div key={c.id} className={`row ${selected === c.id ? 'sel' : ''}`} onClick={() => onJump(c)} data-testid="change-row">
                <span className={`dot ${c.op}`} />
                <div className="rb"><div className="rt"><KindIcon kind={c.kind} />{title(c)}</div><div className="rd">{detail(c)}</div></div>
                <span className="pg">{label(c.pair).replace('Sheet ', '')} · <b>{c.gridRef ?? '-'}</b></span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="sw" style={{ borderColor: '#e5484d', background: 'rgba(229,72,77,.2)' }} />Removed</span>
        <span><i className="sw" style={{ borderColor: '#30a46c', background: 'rgba(48,164,108,.2)' }} />Added</span>
        <span><i className="sw" style={{ borderColor: '#f5a524', background: 'rgba(245,165,36,.25)' }} />Modified</span>
        <span><i className="sw" style={{ borderColor: '#8e7cf0', background: 'rgba(110,86,207,.22)' }} />Moved</span>
        <span><i className="sw dashed" />Graphics</span>
      </div>
    </div>
  );
}
