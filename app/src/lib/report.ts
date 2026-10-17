import type { Change, DiffResult, PagePair, SheetInfo } from './types';
import { opLabel } from './textdiff';

export interface ReportMeta {
  nameA: string; nameB: string; pagesA: number; pagesB: number;
  revA?: string | null; revB?: string | null;
  generated: Date; timeZone?: string;
}

const pad = (s: string, n: number) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 3) + '...');

/** Short description of a change; `max` is the column budget for the whole description (default fits an 80-column row). */
export function describe(c: Change, max = 49): string {
  const sg = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
  const mv = (m?: [number, number]) => (m ? `dx=${sg(m[0])} dy=${sg(m[1])} pt` : '');
  const n0 = (v: number) => String(Math.round(v));
  if (c.kind === 'page') return c.op === 'added' ? 'Page (inserted in Rev B)' : 'Page (deleted from Rev A)';
  if (c.op === 'moved') {
    const tail = ` moved ${mv(c.move)}`;
    if (c.kind === 'text') return `Text "${clip(c.before ?? '', Math.max(6, max - 7 - tail.length))}"${tail}`;
    return clip(`${c.shape ?? 'Graphics'}${tail}`, max);
  }
  if (c.op === 'resized' && c.sizeA && c.sizeB) {
    const sc = c.scale ? ` (x${c.scale[0].toFixed(2)} x${c.scale[1].toFixed(2)})` : '';
    return clip(`${c.shape ?? 'Graphics'} ${n0(c.sizeA[0])}x${n0(c.sizeA[1])} -> ${n0(c.sizeB[0])}x${n0(c.sizeB[1])} pt${sc}`, max);
  }
  if (c.kind === 'graphics') {
    const b = (c.bboxB ?? c.bboxA)!;
    if (c.shape) return clip(`${c.shape} (${n0(b[2] - b[0])}x${n0(b[3] - b[1])} pt)${c.detail ? ' ' + c.detail : ''}`, max);
    const mm = (v: number) => Math.max(1, Math.round((v / 72) * 25.4));
    return `Graphics (${mm(b[2] - b[0])}x${mm(b[3] - b[1])} mm region)`;
  }
  if (c.op === 'modified') {
    const room = Math.max(8, max - 13), b = c.before ?? '', a = c.after ?? '';
    // give the shorter side what it needs, split the rest
    const nb = Math.min(b.length, Math.max(Math.floor(room / 2), room - a.length));
    return `Text "${clip(b, Math.max(4, nb))}" -> "${clip(a, Math.max(4, room - Math.min(b.length, nb)))}"`;
  }
  return `Text "${clip((c.op === 'added' ? c.after : c.before) ?? '', Math.max(8, max - 7))}"`;
}

/** Sheet label used in the report's first column: "Sheet 22/26" or "Page 4". */
export function sheetLabel(p: PagePair, sa: SheetInfo[], sb: SheetInfo[]): string {
  const s = (p.b !== null ? sb[p.b]?.sheet : null) ?? (p.a !== null ? sa[p.a]?.sheet : null);
  return s ? `Sheet ${s}` : `Page ${(p.b ?? p.a ?? 0) + 1}`;
}

function fmtDate(d: Date, tz?: string): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

export function sortKey(c: Change): number {
  const b = (c.bboxB ?? c.bboxA ?? [0, 0, 0, 0]);
  return Math.round(b[1]) * 100000 + Math.round(b[0]);
}

/** Plain-text change list in the PLAN.md §6 format. */
export function formatReport(r: DiffResult, m: ReportMeta): string {
  const W = 72, L: string[] = [];
  const all = r.perPair.flatMap(p => p.changes);
  const cnt = { added: 0, removed: 0, modified: 0, moved: 0, resized: 0 };
  all.forEach(c => cnt[c.op]++);
  const extra = (['moved', 'resized'] as const).filter(k => cnt[k]).map(k => `, ${cnt[k]} ${k}`).join('');
  const tz = m.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offs = r.perPair.filter(p => p.offset[0] !== 0 || p.offset[1] !== 0);
  const sgn = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
  const gridded = all.some(c => c.gridRef);
  L.push('PDF DIFF REPORT', '='.repeat(W));
  L.push(`Rev A      ${pad(m.nameA, 30)}Rev ${pad(m.revA ?? '?', 4)}${m.pagesA} pages`);
  L.push(`Rev B      ${pad(m.nameB, 30)}Rev ${pad(m.revB ?? '?', 4)}${m.pagesB} pages`);
  L.push(`Generated  ${fmtDate(m.generated, tz)} (${tz})`);
  L.push(`Grid       ${gridded ? 'detected' : 'not detected (grid references arrive in phase 2)'}`);
  L.push(`Alignment  ${offs.length ? offs.map(p => `${sheetLabel(r.pairs[p.pair], r.sheetsA, r.sheetsB)}: B offset dx=${sgn(p.offset[0])} dy=${sgn(p.offset[1])} pt (compensated)`).join(', ') : 'no page offset detected'}`);
  L.push(`Totals     ${all.length} change${all.length === 1 ? '' : 's'}: ${cnt.added} added, ${cnt.removed} removed, ${cnt.modified} modified${extra}`);
  L.push('='.repeat(W), '');
  if (r.folded.length) {
    L.push('Repeated on many sheets (title block) - listed once', '-'.repeat(W));
    for (const f of r.folded) {
      const who = f.pairs.length === r.pairs.length ? 'All sheets' : `${f.pairs.length} sheets`;
      const proto = all.find(c => c.id === f.members[0])!;
      const suffix = ` (${f.pairs.length}/${r.pairs.length} sheets)`;
      L.push(`${pad(who, 12)} ${pad('-', 7)} ${pad(opLabel(f.op), 9)} ${describe(proto, 49 - suffix.length)}${suffix}`);
    }
    L.push('');
  }
  const quiet: string[] = [];
  r.pairs.forEach((p, i) => {
    const pr = r.perPair[i];
    const cs = (pr?.changes ?? []).filter(c => !c.foldKey).sort((x, y) => (x.gridRef ?? '').localeCompare(y.gridRef ?? '') || sortKey(x) - sortKey(y));
    const label = sheetLabel(p, r.sheetsA, r.sheetsB);
    if (!cs.length) { quiet.push(label.replace(/^Sheet /, '')); return; }
    const dwg = (p.b !== null ? r.sheetsB[p.b]?.dwg : null) ?? (p.a !== null ? r.sheetsA[p.a]?.dwg : null);
    const pg = `Rev A p.${p.a !== null ? p.a + 1 : '-'} / Rev B p.${p.b !== null ? p.b + 1 : '-'}`;
    L.push(`${label}${dwg ? ' ' + dwg : ''} (${pg}) - ${cs.length} change${cs.length === 1 ? '' : 's'}`, '-'.repeat(W));
    for (const c of cs) L.push(`${pad(label, 12)} ${pad(c.gridRef ?? '-', 7)} ${pad(opLabel(c.op), 9)} ${describe(c)}`);
    L.push('');
  });
  if (quiet.length) {
    // wrap the list at 72 columns, continuation lines indented
    let cur = `No other changes on ${quiet.length} sheet(s):`;
    quiet.forEach((q, i) => {
      const item = q + (i < quiet.length - 1 ? ',' : '');
      if (cur.length + 1 + item.length > W) { L.push(cur); cur = '  ' + item; } else cur += ' ' + item;
    });
    L.push(cur);
  }
  return L.join('\n') + '\n';
}
