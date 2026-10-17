#!/usr/bin/env python3
"""PDF Diff prototype: page pairing, border-grid detection, sheet numbers,
text + vector + raster diff, grouped changes with grid refs, plain-text report,
and side-by-side highlight renders.  Prototype only (PyMuPDF is AGPL)."""
import sys, re, datetime, argparse
from collections import defaultdict
import numpy as np, pymupdf
from scipy.spatial import cKDTree
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFont

TOL = 1.0          # pt, geometric match tolerance
STEP = 1.0         # pt, sampling step along paths
MERGE = 6.0        # pt, gap for merging change boxes into one region

# ---------------------------------------------------------------- grid
def detect_grid(page):
    W, H = page.rect.width, page.rect.height
    band = max(40, 0.05 * min(W, H))
    words = page.get_text('words')
    cand = defaultdict(list)          # edge -> [(label, centre)]
    for w in words:
        t = w[4]
        if not (len(t) <= 2 and (t.isdigit() or (len(t) == 1 and t.isalpha() and t.isupper()))):
            continue
        cx, cy = (w[0]+w[2])/2, (w[1]+w[3])/2
        if cy < band: cand['top'].append((t, cx))
        elif cy > H-band: cand['bottom'].append((t, cx))
        elif cx < band: cand['left'].append((t, cy))
        elif cx > W-band: cand['right'].append((t, cy))
    def axis(edges, kind):
        best = None
        for e in edges:
            pts = [(l, c) for l, c in cand[e] if (l.isdigit() if kind == 'num' else l.isalpha())]
            # de-dup labels
            d = {}
            for l, c in pts: d.setdefault(l, c)
            if len(d) < 3: continue
            keys = sorted(d, key=lambda l: int(l) if kind == 'num' else ord(l))
            vals = [int(k) if kind == 'num' else ord(k) for k in keys]
            if vals != list(range(vals[0], vals[0]+len(vals))): continue   # must be a sequence
            pos = np.array([d[k] for k in keys])
            gaps = np.diff(pos)
            if not (np.all(gaps > 0) or np.all(gaps < 0)): continue
            reg = np.std(np.abs(gaps)) / np.mean(np.abs(gaps))
            if reg > 0.15: continue                                          # even spacing
            score = len(keys) - reg
            if best is None or score > best[0]: best = (score, keys, pos, e)
        return best
    cols = axis(['top', 'bottom'], 'num') or axis(['top', 'bottom'], 'alpha')
    rows = axis(['left', 'right'], 'alpha') or axis(['left', 'right'], 'num')
    if not cols or not rows:
        return None
    def bounds(keys, pos, limit):
        order = np.argsort(pos); keys = [keys[i] for i in order]; pos = pos[order]
        mids = (pos[1:] + pos[:-1]) / 2
        step = np.mean(np.diff(pos))
        edges = np.concatenate([[max(0, pos[0]-step/2)], mids, [min(limit, pos[-1]+step/2)]])
        return keys, edges
    ck, cx = bounds(cols[1], cols[2], W)
    rk, ry = bounds(rows[1], rows[2], H)
    both = sum(1 for e in ('top', 'bottom') if len(cand[e]) >= 3) + sum(1 for e in ('left', 'right') if len(cand[e]) >= 3)
    return dict(cols=ck, xedges=cx, rows=rk, yedges=ry, conf='high' if both == 4 else 'medium')

def cell(grid, x, y):
    ci = int(np.clip(np.searchsorted(grid['xedges'], x) - 1, 0, len(grid['cols'])-1))
    ri = int(np.clip(np.searchsorted(grid['yedges'], y) - 1, 0, len(grid['rows'])-1))
    return ri, ci

def grid_ref(grid, r):
    if not grid: return '-'
    (r0, c0), (r1, c1) = cell(grid, r[0], r[1]), cell(grid, r[2], r[3])
    a = grid['rows'][r0] + grid['cols'][c0]; b = grid['rows'][r1] + grid['cols'][c1]
    if a == b: return a
    # order range top-left -> bottom-right as read on the sheet, normalised label order
    rs = sorted({grid['rows'][r0], grid['rows'][r1]}); cs = sorted({grid['cols'][c0], grid['cols'][c1]}, key=lambda s: int(s) if s.isdigit() else s)
    return f"{rs[0]}{cs[0]}–{rs[-1]}{cs[-1]}"

# ---------------------------------------------------------------- title block
def title_info(page):
    words = page.get_text('words')
    def near(label, pred, dx=(-10, 400), dy=(-5, 40)):
        out = []
        for L in [w for w in words if w[4] == label]:
            for w in words:
                if w is L or not pred(w[4]): continue
                if dx[0] < w[0]-L[0] < dx[1] and dy[0] < w[1]-L[1] < dy[1]:
                    out.append(w)
        return out
    sheet = near('SHEET', lambda t: re.fullmatch(r'\d+\s*(/|OF)\s*\d+', t) is not None, dx=(-10, 200), dy=(-6, 6))
    if not sheet:
        sheet = [w for w in words if re.fullmatch(r'\d+/\d+', w[4])]
    dwg = near('DWG', lambda t: len(t) >= 4 and t not in ('NO', 'SIZE', 'REV') and re.search(r'\d', t) is not None, dy=(-5, 40))
    dwg = max(dwg, key=lambda w: w[3]-w[1])[4] if dwg else None
    rev = near('REV', lambda t: re.fullmatch(r'[A-Z]{1,2}|-|\d{1,2}', t) is not None, dx=(-15, 30), dy=(3, 40))
    rev = max(rev, key=lambda w: w[3]-w[1])[4] if rev else None
    return dict(sheet=sheet[0][4].replace(' ', '') if sheet else None, dwg=dwg, rev=rev)

# ---------------------------------------------------------------- vector
def sample_page(page):
    """Flatten all paths into sample points tagged by style key."""
    pts, keys = [], []
    for d in page.get_drawings():
        k = (d['type'], tuple(round(c, 2) for c in (d.get('color') or ())), tuple(round(c, 2) for c in (d.get('fill') or ())))
        for it in d['items']:
            op = it[0]
            if op == 'l': segs = [(it[1], it[2])]
            elif op == 're':
                r = it[1]; c = [r.tl, r.tr, r.br, r.bl]; segs = list(zip(c, c[1:]+c[:1]))
            elif op == 'qu':
                q = it[1]; c = [q.ul, q.ur, q.lr, q.ll]; segs = list(zip(c, c[1:]+c[:1]))
            elif op == 'c':
                p0, p1, p2, p3 = it[1:5]
                t = np.linspace(0, 1, 9)[:, None]
                P = ((1-t)**3)*np.array(p0) + 3*((1-t)**2)*t*np.array(p1) + 3*(1-t)*t*t*np.array(p2) + (t**3)*np.array(p3)
                segs = [(tuple(P[i]), tuple(P[i+1])) for i in range(len(P)-1)]
            else: continue
            for a, b in segs:
                a = np.array(tuple(a)); b = np.array(tuple(b))
                n = max(1, int(np.hypot(*(b-a)) / STEP))
                s = a + (b-a) * np.linspace(0, 1, n+1)[:, None]
                pts.append(s); keys.extend([k]*len(s))
    if not pts: return np.zeros((0, 2)), []
    return np.vstack(pts), keys

def unmatched(ptsA, keysA, ptsB, keysB):
    """Return mask of A points with no same-style B point within TOL."""
    res = np.ones(len(ptsA), bool)
    byB = defaultdict(list)
    for i, k in enumerate(keysB): byB[k].append(i)
    byA = defaultdict(list)
    for i, k in enumerate(keysA): byA[k].append(i)
    for k, ia in byA.items():
        if k not in byB: continue
        tree = cKDTree(ptsB[byB[k]])
        d, _ = tree.query(ptsA[ia], distance_upper_bound=TOL)
        res[np.array(ia)] = ~np.isfinite(d)
    return res

def point_regions(pts, W, H, min_pts=4):
    if len(pts) == 0: return []
    S = 1.0
    m = np.zeros((int(H/S)+2, int(W/S)+2), bool)
    xy = np.clip((pts/S).astype(int), 0, [m.shape[1]-1, m.shape[0]-1])
    m[xy[:, 1], xy[:, 0]] = True
    md = ndimage.binary_dilation(m, iterations=int(MERGE/2))
    lab, n = ndimage.label(md)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        cnt = int((m[sl] & (lab[sl] == i)).sum())
        if cnt < min_pts: continue
        y0, x0, y1, x1 = sl[0].start, sl[1].start, sl[0].stop, sl[1].stop
        out.append(dict(bbox=(x0*S, y0*S, x1*S, y1*S), n=cnt))
    return out

# ---------------------------------------------------------------- text
def text_changes(pa, pb):
    def toks(p): return [(w[4], np.array([(w[0]+w[2])/2, (w[1]+w[3])/2]), w[:4]) for w in p.get_text('words')]
    A, B = toks(pa), toks(pb)
    usedB = set(); remA = []
    idx = defaultdict(list)
    for j, (t, c, _) in enumerate(B): idx[t].append(j)
    for t, c, bb in A:
        best = None
        for j in idx.get(t, []):
            if j in usedB: continue
            d = np.hypot(*(B[j][1]-c))
            if d < 3 and (best is None or d < best[0]): best = (d, j)
        if best: usedB.add(best[1])
        else: remA.append((t, bb))
    addB = [(t, bb) for j, (t, c, bb) in enumerate(B) if j not in usedB]
    return remA, addB

# ---------------------------------------------------------------- raster
def raster_diff(pa, pb, dpi=72):
    a = pa.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY); b = pb.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    A = np.frombuffer(a.samples, np.uint8).reshape(a.h, a.w).astype(int)
    B = np.frombuffer(b.samples, np.uint8).reshape(b.h, b.w).astype(int)
    h, w = min(A.shape[0], B.shape[0]), min(A.shape[1], B.shape[1])
    A, B = A[:h, :w], B[:h, :w]
    # tolerance: a pixel only differs if no pixel within 1px in the other image is close
    Amin, Amax = ndimage.minimum_filter(A, 3), ndimage.maximum_filter(A, 3)
    Bmin, Bmax = ndimage.minimum_filter(B, 3), ndimage.maximum_filter(B, 3)
    diff = ((A < Bmin-60) | (A > Bmax+60) | (B < Amin-60) | (B > Amax+60))
    diff = ndimage.binary_opening(diff, iterations=1)
    s = 72/dpi
    lab, n = ndimage.label(ndimage.binary_dilation(diff, iterations=3))
    return [dict(bbox=(sl[1].start*s, sl[0].start*s, sl[1].stop*s, sl[0].stop*s)) for sl in ndimage.find_objects(lab)]

# ---------------------------------------------------------------- grouping
def overlap(a, b, pad=MERGE):
    return not (a[2]+pad < b[0] or b[2]+pad < a[0] or a[3]+pad < b[1] or b[3]+pad < a[1])
def union(a, b): return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

def merge(items):
    items = [dict(i) for i in items]
    changed = True
    while changed:
        changed = False
        out = []
        for it in items:
            for o in out:
                if overlap(o['bbox'], it['bbox']):
                    o['bbox'] = union(o['bbox'], it['bbox'])
                    for k in ('remA', 'addB', 'vrem', 'vadd', 'ras'):
                        o[k] = o.get(k, []) + it.get(k, [])
                    changed = True; break
            else: out.append(it)
        items = out
    return items

def lines_text(ws):
    ws = sorted(ws, key=lambda w: (round(w[1][1]/4), w[1][0]))
    return ' '.join(t for t, _ in ws)

def describe(g):
    rt, at = g.get('remA', []), g.get('addB', [])
    vr, va = sum(r['n'] for r in g.get('vrem', [])), sum(r['n'] for r in g.get('vadd', []))
    def clip(s, n=46): return s if len(s) <= n else s[:n-3]+'...'
    if rt or at:
        if rt and at: op, d = 'Modified', f'Text "{clip(lines_text(rt),22)}" -> "{clip(lines_text(at),22)}"'
        elif at: op, d = 'Added', f'Text "{clip(lines_text(at))}"'
        else: op, d = 'Removed', f'Text "{clip(lines_text(rt))}"'
        if vr or va: d += ' + geometry'
        return op, d
    if vr or va:
        op = 'Modified' if vr and va else ('Added' if va else 'Removed')
        x0, y0, x1, y1 = g['bbox']
        size = f'{(x1-x0)/72*25.4:.0f}x{(y1-y0)/72*25.4:.0f} mm'
        return op, f'Geometry ({size}; ~{int(vr*STEP)} pt removed, ~{int(va*STEP)} pt added)'.replace('~0 pt removed, ', '').replace(', ~0 pt added', '')
    return 'Modified', 'Raster difference (not explained by text/vector)'

# ---------------------------------------------------------------- main compare
def pair_pages(da, db):
    ka = [title_info(p)['sheet'] or f'#{i}' for i, p in enumerate(da)]
    kb = [title_info(p)['sheet'] or f'#{i}' for i, p in enumerate(db)]
    pairs, used = [], set()
    for i, k in enumerate(ka):
        j = kb.index(k) if k in kb and kb.index(k) not in used else (i if i < len(db) and i not in used else None)
        if j is not None: used.add(j)
        pairs.append((i, j))
    pairs += [(None, j) for j in range(len(db)) if j not in used]
    return pairs

def compare(fa, fb, labA, labB):
    da, db = pymupdf.open(fa), pymupdf.open(fb)
    sheets = []
    for ia, ib in pair_pages(da, db):
        if ia is None or ib is None:
            sheets.append(dict(ia=ia, ib=ib, info={}, grid=None, changes=[dict(op='Added' if ia is None else 'Removed', desc='Page', bbox=None, ref='-')])); continue
        pa, pb = da[ia], db[ib]
        info = title_info(pb); infoA = title_info(pa)
        grid = detect_grid(pb) or detect_grid(pa)
        W, H = pb.rect.width, pb.rect.height
        remA, addB = text_changes(pa, pb)
        sA, kA = sample_page(pa); sB, kB = sample_page(pb)
        uA = unmatched(sA, kA, sB, kB); uB = unmatched(sB, kB, sA, kA)
        vrem = point_regions(sA[uA], W, H); vadd = point_regions(sB[uB], W, H)
        items = [dict(bbox=tuple(bb), remA=[(t, np.array([(bb[0]+bb[2])/2, (bb[1]+bb[3])/2]))]) for t, bb in remA]
        items += [dict(bbox=tuple(bb), addB=[(t, np.array([(bb[0]+bb[2])/2, (bb[1]+bb[3])/2]))]) for t, bb in addB]
        items += [dict(bbox=r['bbox'], vrem=[r]) for r in vrem] + [dict(bbox=r['bbox'], vadd=[r]) for r in vadd]
        groups = merge(items)
        # raster fallback: anything not covered by text/vector groups
        for r in raster_diff(pa, pb):
            if not any(overlap(g['bbox'], r['bbox'], 2) for g in groups):
                groups.append(dict(bbox=r['bbox'], ras=[r]))
        groups = merge(groups)
        ch = []
        for g in groups:
            op, desc = describe(g)
            ch.append(dict(op=op, desc=desc, bbox=g['bbox'], ref=grid_ref(grid, g['bbox']), g=g))
        def sk(c):
            if not grid: return (c['bbox'][1], c['bbox'][0])
            r, cc = cell(grid, (c['bbox'][0]+c['bbox'][2])/2, (c['bbox'][1]+c['bbox'][3])/2)
            return (grid['rows'][r], int(grid['cols'][cc]) if grid['cols'][cc].isdigit() else grid['cols'][cc])
        ch.sort(key=sk)
        sheets.append(dict(ia=ia, ib=ib, info=info, infoA=infoA, grid=grid, changes=ch,
                           nvec=(len(kA), len(kB)), nitems=(sum(len(d['items']) for d in pa.get_drawings()), sum(len(d['items']) for d in pb.get_drawings()))))
    return da, db, sheets

# ---------------------------------------------------------------- report
def report(fa, fb, labA, labB, da, db, sheets):
    allc = [c for s in sheets for c in s['changes']]
    cnt = defaultdict(int)
    for c in allc: cnt[c['op']] += 1
    grids = [s['grid'] for s in sheets if s.get('grid')]
    gl = 'none detected'
    if grids:
        g = grids[0]
        gl = f"Border zone on {len(grids)}/{len(sheets)} sheets, rows {min(g['rows'])}-{max(g['rows'])}, columns {sorted(g['cols'],key=int)[0]}-{sorted(g['cols'],key=int)[-1]} ({g['conf']} confidence)"
    L = ['PDF DIFF REPORT', '='*72,
         f'Rev A      {fa.split("/")[-1]:<30} Rev {labA:<3} {da.page_count} pages',
         f'Rev B      {fb.split("/")[-1]:<30} Rev {labB:<3} {db.page_count} pages',
         f'Generated  {datetime.datetime.now():%Y-%m-%d %H:%M} (Europe/Oslo)',
         f'Grid       {gl}',
         f'Totals     {len(allc)} changes: {cnt["Added"]} added, {cnt["Removed"]} removed, {cnt["Modified"]} modified',
         '='*72, '']
    # collapse changes repeated on many sheets (e.g. REV letter in every title block)
    from collections import Counter
    rep = Counter((c['op'], c['desc']) for s in sheets for c in s['changes'])
    repeated = {k for k, n in rep.items() if n >= max(5, len(sheets)//2)}
    if repeated:
        L.append('Repeated on many sheets (title block) - listed once')
        L.append('-'*72)
        for k in sorted(repeated):
            shs = [s for s in sheets if any((c['op'], c['desc']) == k for c in s['changes'])]
            L.append(f"{'All sheets' if len(shs)==len(sheets) else str(len(shs))+' sheets':<12} {'-':<7} {k[0]:<9} {k[1]} ({len(shs)}/{len(sheets)} sheets)")
        L.append('')
    for s in sheets:
        s['changes_r'] = [c for c in s['changes'] if (c['op'], c['desc']) not in repeated]
    for s in sheets:
        if not s['changes_r']: continue
        info = s.get('info', {})
        sh = f"Sheet {info['sheet']}" if info.get('sheet') else f"Page {(s['ib'] if s['ib'] is not None else s['ia'])+1}"
        pg = f"Rev A p.{s['ia']+1 if s['ia'] is not None else '-'} / Rev B p.{s['ib']+1 if s['ib'] is not None else '-'}"
        L.append(f"{sh} {info.get('dwg') or ''} ({pg}) - {len(s['changes_r'])} change{'s' if len(s['changes_r'])!=1 else ''}".replace('  ', ' '))
        L.append('-'*72)
        for c in s['changes_r']:
            L.append(f"{sh:<12} {c['ref']:<7} {c['op']:<9} {c['desc']}")
        L.append('')
    unchanged = [s for s in sheets if not s['changes_r']]
    if unchanged:
        L.append(f'No other changes on {len(unchanged)} sheet(s): ' + ', '.join((s.get('info') or {}).get('sheet') or '?' for s in unchanged))
    return '\n'.join(L) + '\n'

# ---------------------------------------------------------------- renders
COL = {'Removed': (229, 72, 77), 'Added': (48, 164, 108), 'Modified': (245, 165, 36)}
def render(da, db, s, path, zoom=None):
    pa, pb = da[s['ia']], db[s['ib']]
    W = pb.rect.width
    target = 1500
    sc = target / W
    ims = []
    for side, p in (('A', pa), ('B', pb)):
        pix = p.get_pixmap(matrix=pymupdf.Matrix(sc, sc))
        im = Image.frombytes('RGB', (pix.w, pix.h), pix.samples).convert('RGBA')
        ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
        for c in s['changes']:
            if not c['bbox']: continue
            op = c['op']
            # removed shown on A only, added on B only, modified on both
            if (op == 'Removed' and side == 'B') or (op == 'Added' and side == 'A'): continue
            x0, y0, x1, y1 = [v*sc for v in c['bbox']]
            pad = 4
            col = COL[op]
            dr.rectangle([x0-pad, y0-pad, x1+pad, y1+pad], fill=col+(45,), outline=col+(255,), width=3)
            dr.text((x0-pad, y0-pad-14), c['ref'], fill=col+(255,), font=ImageFont.load_default(13))
        ims.append(Image.alpha_composite(im, ov).convert('RGB'))
    hdr = 40
    out = Image.new('RGB', (ims[0].width+ims[1].width+30, max(i.height for i in ims)+hdr), (22, 24, 29))
    out.paste(ims[0], (10, hdr)); out.paste(ims[1], (20+ims[0].width, hdr))
    d = ImageDraw.Draw(out); f = ImageFont.load_default(18)
    info = s['info']
    d.text((12, 10), f"Rev A (old) · page {s['ia']+1} · sheet {s['infoA'].get('sheet')} · rev {s['infoA'].get('rev')}", fill=(255, 133, 137), font=f)
    d.text((22+ims[0].width, 10), f"Rev B (new) · page {s['ib']+1} · sheet {info.get('sheet')} · rev {info.get('rev')}   red=removed green=added amber=modified", fill=(76, 195, 138), font=f)
    out.save(path)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('a'); ap.add_argument('b'); ap.add_argument('--out', default='out')
    ap.add_argument('--label-a', default='?'); ap.add_argument('--label-b', default='?')
    a = ap.parse_args()
    import os; os.makedirs(a.out, exist_ok=True)
    da, db, sheets = compare(a.a, a.b, a.label_a, a.label_b)
    txt = report(a.a, a.b, a.label_a, a.label_b, da, db, sheets)
    open(f'{a.out}/report.txt', 'w').write(txt)
    print(txt)
    for s in sheets:
        if s['ia'] is not None and s['ib'] is not None:
            g = s['grid']
            print('page', s['ia']+1, 'sheet', s['info'].get('sheet'), 'dwg', s['info'].get('dwg'), 'rev', s.get('infoA', {}).get('rev'), '->', s['info'].get('rev'),
                  'grid', (g['rows'], g['cols'], [round(x) for x in g['xedges']], [round(y) for y in g['yedges']]) if g else None,
                  'samples', s['nvec'], 'items', s['nitems'], file=sys.stderr)
    top = sorted([s for s in sheets if s['ia'] is not None and s['ib'] is not None], key=lambda s: -len(s['changes']))[:3]
    for s in top:
        p = f"{a.out}/sheet_{(s['info'].get('sheet') or str(s['ib']+1)).replace('/', 'of')}.png"
        render(da, db, s, p); print('render', p, file=sys.stderr)
