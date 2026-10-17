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
ALIGN = True       # estimate + compensate a global page offset
PAIR = True        # pair removed/added shapes into moved/resized/rotated/style changes
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
STYLE_IDS = {}
def style_id(d):
    k = (d['type'], tuple(round(c, 2) for c in (d.get('color') or ())), tuple(round(c, 2) for c in (d.get('fill') or ())),
         round(d.get('width') or 0, 2), ' '.join((d.get('dashes') or '').split()))
    return STYLE_IDS.setdefault(k, len(STYLE_IDS)), k

def sample_page(page, shift=(0.0, 0.0)):
    """Flatten all paths into sample points tagged by style id and path id.
    Clip paths (scissor rects) are honoured: samples outside the active clip are dropped.
    `shift` is subtracted from all coordinates (page alignment)."""
    pts, sid, pid, meta = [], [], [], []
    stack = []                                   # [(level, (x0,y0,x1,y1))]
    for d in page.get_drawings(extended=True):
        lvl = d.get('level', 0)
        while stack and stack[-1][0] >= lvl: stack.pop()
        if d['type'] == 'clip':
            r = d['scissor']; c = (r.x0, r.y0, r.x1, r.y1)
            if stack:
                o = stack[-1][1]; c = (max(c[0], o[0]), max(c[1], o[1]), min(c[2], o[2]), min(c[3], o[3]))
            stack.append((lvl, c)); continue
        if d['type'] == 'group': continue
        clip = stack[-1][1] if stack else None
        k, key = style_id(d)
        # split the drawing into connected sub-paths (a new sub-path starts where an item
        # does not begin at the previous item's end point)
        subs, cur, last = [], [], None
        def flush():
            nonlocal cur
            if cur: subs.append(cur)
            cur = []
        for it in d['items']:
            op = it[0]; segs = []
            if op == 'l': segs = [(it[1], it[2])]
            elif op == 're':
                r = it[1]; c = [r.tl, r.tr, r.br, r.bl]; segs = list(zip(c, c[1:]+c[:1])); flush()
            elif op == 'qu':
                q = it[1]; c = [q.ul, q.ur, q.lr, q.ll]; segs = list(zip(c, c[1:]+c[:1])); flush()
            elif op == 'c':
                p0, p1, p2, p3 = [np.array(tuple(x)) for x in it[1:5]]
                t = np.linspace(0, 1, 9)[:, None]
                Pc = ((1-t)**3)*p0 + 3*((1-t)**2)*t*p1 + 3*(1-t)*t*t*p2 + (t**3)*p3
                segs = [(Pc[i], Pc[i+1]) for i in range(len(Pc)-1)]
            if not segs: continue
            st = np.array(tuple(segs[0][0]), float)
            if last is None or np.hypot(*(st-last)) > 0.05: flush()
            cur += segs; last = np.array(tuple(segs[-1][1]), float)
            if op in ('re', 'qu'): flush(); last = None
        flush()
        for segs in subs:
            S = []
            for a_, b_ in segs:
                a_ = np.array(tuple(a_), float); b_ = np.array(tuple(b_), float)
                n = max(1, int(np.hypot(*(b_-a_)) / STEP))
                S.append(a_ + (b_-a_) * np.linspace(0, 1, n+1)[:, None])
            S = np.vstack(S)
            if clip is not None:
                keep = (S[:, 0] >= clip[0]-0.5) & (S[:, 0] <= clip[2]+0.5) & (S[:, 1] >= clip[1]-0.5) & (S[:, 1] <= clip[3]+0.5)
                S = S[keep]
                if not len(S): continue
            S = S - np.asarray(shift)
            i = len(meta); meta.append(dict(style=key, sid=k))
            pts.append(S); sid.append(np.full(len(S), k)); pid.append(np.full(len(S), i))
    if not pts: return np.zeros((0, 2)), np.zeros(0, int), np.zeros(0, int), []
    return np.vstack(pts), np.concatenate(sid), np.concatenate(pid), meta

def unmatched(ptsA, sA, ptsB, sB, ignore_style=False):
    """Mask of A samples with no (same-style) B sample within TOL."""
    res = np.ones(len(ptsA), bool)
    if ignore_style:
        if len(ptsB):
            d, _ = cKDTree(ptsB).query(ptsA, distance_upper_bound=TOL); res = ~np.isfinite(d)
        return res
    for k in np.unique(sA):
        ia = np.where(sA == k)[0]; ib = np.where(sB == k)[0]
        if not len(ib): continue
        d, _ = cKDTree(ptsB[ib]).query(ptsA[ia], distance_upper_bound=TOL)
        res[ia] = ~np.isfinite(d)
    return res

def point_regions(pts, W, H, min_pts=4):
    """Cluster points into regions; returns [{bbox, n, idx}] with idx = indices into pts."""
    if len(pts) == 0: return []
    m = np.zeros((int(H)+12, int(W)+12), np.int32)
    xy = np.clip(pts.astype(int) + 5, 0, [m.shape[1]-1, m.shape[0]-1])
    occ = np.zeros(m.shape, bool); occ[xy[:, 1], xy[:, 0]] = True
    lab, n = ndimage.label(ndimage.binary_dilation(occ, iterations=int(MERGE/2)))
    L = lab[xy[:, 1], xy[:, 0]]
    out = []
    for i in range(1, n+1):
        idx = np.where(L == i)[0]
        if len(idx) < min_pts: continue
        P = pts[idx]
        out.append(dict(bbox=(P[:, 0].min()-2, P[:, 1].min()-2, P[:, 0].max()+2, P[:, 1].max()+2), n=len(idx), idx=idx))
    return out

# ---------------------------------------------------------------- shape pairing
def _sub(P, n=500):
    if len(P) <= n: return P
    return P[np.linspace(0, len(P)-1, n).astype(int)]

def fit_transform(P, Q):
    """Find similarity transform (scale s, rotation th deg, translation) mapping cloud P onto Q.
    Returns (score, s, th, (dx, dy)) where (dx, dy) is the centroid displacement."""
    P, Q = _sub(P), _sub(Q)
    if len(P) < 4 or len(Q) < 4: return None
    cP, cQ = P.mean(0), Q.mean(0)
    rP = np.sqrt(((P-cP)**2).sum(1).mean()); rQ = np.sqrt(((Q-cQ)**2).sum(1).mean())
    if rP < 0.5 or rQ < 0.5: return None
    s = rQ / rP
    tQ = cKDTree(Q); tol = 1.5*TOL
    def score(th, t):
        a = np.radians(th); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        P2 = (P-cP) @ R.T * s + cQ + t
        d1, _ = tQ.query(P2); d2, _ = cKDTree(P2).query(Q)
        return min((d1 < tol).mean(), (d2 < tol).mean()), (d1.mean() + d2.mean())/2, P2
    coarse = [(th,) + score(th, 0)[:2] for th in range(-180, 180, 3)]
    bf = max(c[1] for c in coarse)
    ok = [c for c in coarse if c[1] >= bf - 0.02]
    mdmin = min(c[2] for c in ok)
    th = min((c for c in ok if c[2] <= mdmin + 0.1), key=lambda c: abs(c[0]))[0]   # symmetric shapes: smallest angle
    fine = [(th+d,) + score(th+d, 0)[:2] for d in np.arange(-3, 3.01, 0.25)]
    th = float(min(fine, key=lambda c: c[2])[0])
    t = np.zeros(2)
    for _ in range(4):                          # translation refinement (ICP, median)
        sc, md, P2 = score(th, t)
        d, j = tQ.query(P2)
        okm = d < 4*tol
        if okm.sum() < 4: break
        t = t + np.median(Q[j[okm]] - P2[okm], axis=0)
    sc, md, _ = score(th, t)
    th = (th + 180) % 360 - 180
    return sc, s, th, tuple(cQ + t - cP)

def style_str(st):
    t, col, fill, w, dash = st
    return f"col {col or '-'} w {w} dash {dash or 'solid'}"

def classify_xf(s, th, d, styleA, styleB):
    mv = np.hypot(*d) >= 0.75; rs = abs(s-1) >= 0.03; rt = abs(th) >= 1.0
    parts = []
    if rt: parts.append(f'rotated {th:+.0f} deg')
    if rs: parts.append(f'resized x{s:.2f}')
    if mv: parts.append(f'moved dx={d[0]:+.1f} dy={d[1]:+.1f} pt')
    if not parts:
        if styleA != styleB:
            ch = []
            if styleA[1] != styleB[1] or styleA[2] != styleB[2]: ch.append(f'colour {styleA[1] or styleA[2]} -> {styleB[1] or styleB[2]}')
            if styleA[3] != styleB[3]: ch.append(f'width {styleA[3]} -> {styleB[3]}')
            if styleA[4] != styleB[4]: ch.append(f'dash {styleA[4] or "solid"} -> {styleB[4] or "solid"}')
            return 'Modified', 'Style only: ' + ', '.join(ch or ['other'])
        return 'Modified', 'Geometry (re-drawn, same shape)'
    op = 'Rotated' if rt else ('Resized' if rs else 'Moved')
    return op, 'Geometry ' + ', '.join(parts)

def changed_groups(pts, pid, um):
    """Sub-paths with a large unmatched share, clustered into groups of nearby sub-paths."""
    tot = np.bincount(pid, minlength=pid.max()+1 if len(pid) else 0)
    bad = np.bincount(pid[um], minlength=len(tot))
    ch = [i for i in range(len(tot)) if bad[i] >= 3 and bad[i] >= 0.3*tot[i]]
    boxes = []
    for i in ch:
        P = pts[pid == i]; boxes.append(dict(bbox=(P[:, 0].min(), P[:, 1].min(), P[:, 0].max(), P[:, 1].max()), ids={i}))
    changed = True
    while changed:
        changed = False; out = []
        for bx in boxes:
            for o in out:
                if overlap(o['bbox'], bx['bbox'], 2):
                    o['bbox'] = union(o['bbox'], bx['bbox']); o['ids'] |= bx['ids']; changed = True; break
            else: out.append(bx)
        boxes = out
    return boxes

def pair_shapes(ptsA, pA, uA, mA, ptsB, pB, uB, mB):
    """Pair changed sub-path groups of A and B that are the same shape under a similarity transform.
    Returns (pairs, explained_A_mask, explained_B_mask)."""
    if not len(ptsA) or not len(ptsB): return [], np.zeros(len(ptsA), bool), np.zeros(len(ptsB), bool)
    GA, GB = changed_groups(ptsA, pA, uA), changed_groups(ptsB, pB, uB)
    cand = []
    for i, ga in enumerate(GA):
        PA = ptsA[np.isin(pA, list(ga['ids']))]
        for j, gb in enumerate(GB):
            PB = ptsB[np.isin(pB, list(gb['ids']))]
            if not (0.4 < len(PB)/max(1, len(PA)) < 2.5): continue
            f = fit_transform(PA, PB)
            if f and f[0] >= 0.85: cand.append((f[0], i, j, f))
    cand.sort(key=lambda c: -c[0]); ui, uj, out = set(), set(), []
    exA, exB = np.zeros(len(ptsA), bool), np.zeros(len(ptsB), bool)
    for sc, i, j, (score, s, th, d) in cand:
        if i in ui or j in uj: continue
        ui.add(i); uj.add(j)
        ida, idb = list(GA[i]['ids']), list(GB[j]['ids'])
        mskA, mskB = np.isin(pA, ida), np.isin(pB, idb)
        exA |= mskA; exB |= mskB
        stA = mA[ida[0]]['style']; stB = mB[idb[0]]['style']
        op, desc = classify_xf(s, th, d, stA, stB)
        if op == 'Rotated':      # report the pivot instead of a centroid shift
            cP = ptsA[mskA].mean(0); cQ = cP + np.array(d)
            a = np.radians(th); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
            try:
                c = np.linalg.solve(np.eye(2) - R, cQ - R @ cP)
                desc = desc.split(', moved')[0] + f' about ({c[0]:.0f}, {c[1]:.0f})'
            except np.linalg.LinAlgError: pass
        PA_, PB_ = ptsA[mskA], ptsB[mskB]
        out.append(dict(op=op, desc=desc, score=score, d=d,
                        bboxA=(PA_[:, 0].min()-2, PA_[:, 1].min()-2, PA_[:, 0].max()+2, PA_[:, 1].max()+2),
                        bboxB=(PB_[:, 0].min()-2, PB_[:, 1].min()-2, PB_[:, 0].max()+2, PB_[:, 1].max()+2),
                        cA=tuple(PA_.mean(0)), cB=tuple(PB_.mean(0))))
    return out, exA, exB

# ---------------------------------------------------------------- text
def words(page, shift=(0, 0)):
    return [(w[4], (w[0]-shift[0], w[1]-shift[1], w[2]-shift[0], w[3]-shift[1])) for w in page.get_text('words')]

def text_changes(WA, WB):
    """Position-aware word matching: same text within 3 pt. Returns (removed A words, added B words)."""
    def ctr(bb): return np.array([(bb[0]+bb[2])/2, (bb[1]+bb[3])/2])
    usedB = set(); remA = []
    idx = defaultdict(list)
    for j, (t, bb) in enumerate(WB): idx[t].append(j)
    for t, bb in WA:
        best = None
        for j in idx.get(t, []):
            if j in usedB: continue
            d = np.hypot(*(ctr(WB[j][1]) - ctr(bb)))
            if d < 3 and (best is None or d < best[0]): best = (d, j)
        if best: usedB.add(best[1])
        else: remA.append((t, bb))
    return remA, [w for j, w in enumerate(WB) if j not in usedB]

def moved_text(remA, addB):
    """Find groups of removed/added words that are the same text displaced by a common offset."""
    def ctr(bb): return np.array([(bb[0]+bb[2])/2, (bb[1]+bb[3])/2])
    moves = []
    remA, addB = list(remA), list(addB)
    for _ in range(3):
        votes = defaultdict(list)
        for i, (t, a) in enumerate(remA):
            for j, (u, b) in enumerate(addB):
                if t == u:
                    o = ctr(b) - ctr(a)
                    if np.hypot(*o) >= 3: votes[(round(o[0]*2)/2, round(o[1]*2)/2)].append((i, j))
        if not votes: break
        off, pairs = max(votes.items(), key=lambda kv: len({i for i, _ in kv[1]}))
        if len({i for i, _ in pairs}) < 2 and not (len(remA) == 1 and len(addB) == 1): break
        ui, uj, sel = set(), set(), []
        for i, j in pairs:
            if i in ui or j in uj: continue
            ui.add(i); uj.add(j); sel.append((remA[i], addB[j]))
        moves.append(dict(off=off, pairs=sel))
        remA = [w for i, w in enumerate(remA) if i not in ui]; addB = [w for j, w in enumerate(addB) if j not in uj]
    return moves, remA, addB

def estimate_offset(pa, pb):
    """Global B-minus-A translation from words whose text is unique on both pages."""
    def uniq(p):
        c = defaultdict(list)
        for w in p.get_text('words'): c[w[4]].append(w)
        return {t: v[0] for t, v in c.items() if len(v) == 1 and len(t) >= 2}
    A, B = uniq(pa), uniq(pb)
    common = [t for t in A if t in B]
    if len(common) < 5: return (0.0, 0.0), 0
    o = np.array([[(B[t][0]+B[t][2]-A[t][0]-A[t][2])/2, (B[t][1]+B[t][3]-A[t][1]-A[t][3])/2] for t in common])
    med = np.median(o, axis=0)
    inl = (np.hypot(*(o-med).T) < 0.5).mean()
    if inl < 0.6 or np.hypot(*med) < 0.25: return (0.0, 0.0), inl
    return (float(med[0]), float(med[1])), inl

# ---------------------------------------------------------------- raster
def raster_diff(pa, pb, dpi=72, shift=(0, 0)):
    a = pa.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    b = pb.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, clip=pb.rect + (shift[0], shift[1], shift[0], shift[1]))
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
                    for k in ('bboxA', 'bboxB'):
                        if it.get(k): o[k] = union(o[k], it[k]) if o.get(k) else it[k]
                    for k in ('remA', 'addB', 'vrem', 'vadd', 'ras', 'xf', 'tmove'):
                        o[k] = o.get(k, []) + it.get(k, [])
                    changed = True; break
            else: out.append(it)
        items = out
    return items


def describe(g):
    rt, at = g.get('remA', []), g.get('addB', [])
    vr, va = sum(r['n'] for r in g.get('vrem', [])), sum(r['n'] for r in g.get('vadd', []))
    xf, tm = g.get('xf', []), g.get('tmove', [])
    def clip(s, n=46): return s if len(s) <= n else s[:n-3]+'...'
    extra = []
    if xf:
        op, d = xf[0]['op'], xf[0]['desc']
        if len(xf) > 1: d += f' (+{len(xf)-1} more shapes)'
        if tm: d += f', with text "{clip(lines_text([w for m in tm for w, _ in m["pairs"]]), 24)}"'
        if rt or at or vr or va: d += ' + other edits'
        return op, d
    if tm:
        m = tm[0]; txt = lines_text([a for a, _ in m['pairs']])
        d = f'Text "{clip(txt, 30)}" moved dx={m["off"][0]:+.1f} dy={m["off"][1]:+.1f} pt'
        if rt or at or vr or va: d += ' + other edits'
        return 'Moved', d
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

def lines_text(ws):
    def key(w):
        bb = w[1]; return (round(bb[1]/4), bb[0])
    return ' '.join(t for t, _ in sorted(ws, key=key))

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
        grid = detect_grid(pa) or detect_grid(pb)
        W, H = pb.rect.width, pb.rect.height
        off, inl = estimate_offset(pa, pb) if ALIGN else ((0.0, 0.0), 0)
        if off != (0.0, 0.0):          # accept the text-based offset only if it also explains the geometry better
            qa, _, _, _ = sample_page(pa); qb, _, _, _ = sample_page(pb)
            if len(qa) and len(qb):
                sub = qa[np.linspace(0, len(qa)-1, min(3000, len(qa))).astype(int)]
                tb = cKDTree(qb)
                f0 = (tb.query(sub)[0] < TOL).mean(); f1 = (tb.query(sub + np.array(off))[0] < TOL).mean()
                if f1 < f0 + 0.1: off = (0.0, 0.0)
        WA, WB = words(pa), words(pb, off)
        remA, addB = text_changes(WA, WB)
        tmoves, remA, addB = moved_text(remA, addB)
        ptsA, sA, pA, mA = sample_page(pa); ptsB, sB, pB, mB = sample_page(pb, off)
        uA = unmatched(ptsA, sA, ptsB, sB); uB = unmatched(ptsB, sB, ptsA, sA)
        pairs, exA, exB = pair_shapes(ptsA, pA, uA, mA, ptsB, pB, uB, mB) if PAIR else ([], np.zeros(len(ptsA), bool), np.zeros(len(ptsB), bool))
        iA, iB = np.where(uA & ~exA)[0], np.where(uB & ~exB)[0]
        vrem = point_regions(ptsA[iA], W, H); vadd = point_regions(ptsB[iB], W, H)
        items = []
        for pr in pairs:
            items.append(dict(bbox=union(pr['bboxA'], pr['bboxB']), bboxA=pr['bboxA'], bboxB=pr['bboxB'], xf=[pr]))
        for m in tmoves:
            bb = tuple(np.array([w[1] for _, w in m['pairs']]).min(0)[:2]) + tuple(np.array([w[1] for _, w in m['pairs']]).max(0)[2:])
            ba = tuple(np.array([w[1] for w, _ in m['pairs']]).min(0)[:2]) + tuple(np.array([w[1] for w, _ in m['pairs']]).max(0)[2:])
            items.append(dict(bbox=union(ba, bb), bboxA=ba, bboxB=bb, tmove=[m]))
        items += [dict(bbox=tuple(bb), bboxA=tuple(bb), remA=[(t, bb)]) for t, bb in remA]
        items += [dict(bbox=tuple(bb), bboxB=tuple(bb), addB=[(t, bb)]) for t, bb in addB]
        items += [dict(bbox=r['bbox'], bboxA=r['bbox'], vrem=[r]) for r in vrem]
        items += [dict(bbox=r['bbox'], bboxB=r['bbox'], vadd=[r]) for r in vadd]
        groups = merge(items)
        for r in raster_diff(pa, pb, shift=off):
            if not any(overlap(g['bbox'], r['bbox'], 2) for g in groups):
                groups.append(dict(bbox=r['bbox'], bboxA=r['bbox'], bboxB=r['bbox'], ras=[r]))
        groups = merge(groups)
        ch = []
        for g in groups:
            op, desc = describe(g)
            ref = grid_ref(grid, g['bbox'])
            if grid and g.get('bboxA') and g.get('bboxB') and (g.get('xf') or g.get('tmove')):
                def cref(bb):
                    r_, c_ = cell(grid, (bb[0]+bb[2])/2, (bb[1]+bb[3])/2); return grid['rows'][r_] + grid['cols'][c_]
                ra, rb = cref(g['bboxA']), cref(g['bboxB'])
                ref = ra if ra == rb else f'{ra}>{rb}'
            ch.append(dict(op=op, desc=desc, bbox=g['bbox'], bboxA=g.get('bboxA'), bboxB=g.get('bboxB'), ref=ref, g=g))
        def sk(c):
            if not grid: return (c['bbox'][1], c['bbox'][0])
            r, cc = cell(grid, (c['bbox'][0]+c['bbox'][2])/2, (c['bbox'][1]+c['bbox'][3])/2)
            return (grid['rows'][r], int(grid['cols'][cc]) if grid['cols'][cc].isdigit() else grid['cols'][cc])
        ch.sort(key=sk)
        sheets.append(dict(ia=ia, ib=ib, info=info, infoA=infoA, grid=grid, changes=ch, offset=off,
                           nvec=(len(ptsA), len(ptsB)), nitems=(sum(len(d['items']) for d in pa.get_drawings()), sum(len(d['items']) for d in pb.get_drawings()))))
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
         f'Alignment  ' + (', '.join(f"sheet {(s.get('info') or {}).get('sheet') or s['ib']+1}: B offset dx={s['offset'][0]:+.1f} dy={s['offset'][1]:+.1f} pt (compensated)" for s in sheets if s.get('offset') and s['offset'] != (0.0, 0.0)) or 'no page offset detected'),
         f'Totals     {len(allc)} changes: ' + ', '.join(f'{cnt[k]} {k.lower()}' for k in ('Added', 'Removed', 'Modified', 'Moved', 'Resized', 'Rotated') if cnt[k] or k in ('Added', 'Removed', 'Modified')),
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
COL = {'Removed': (229, 72, 77), 'Added': (48, 164, 108), 'Modified': (245, 165, 36), 'Moved': (110, 86, 207), 'Resized': (110, 86, 207), 'Rotated': (110, 86, 207)}
def render(da, db, s, path, target_w=1500):
    pa, pb = da[s['ia']], db[s['ib']]
    W = pb.rect.width
    target = target_w
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
            bb = (c.get('bboxA') if side == 'A' else c.get('bboxB')) or c['bbox']
            if side == 'B': bb = (bb[0]+s['offset'][0], bb[1]+s['offset'][1], bb[2]+s['offset'][0], bb[3]+s['offset'][1])
            x0, y0, x1, y1 = [v*sc for v in bb]
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
    d.text((22+ims[0].width, 10), f"Rev B (new) · page {s['ib']+1} · sheet {info.get('sheet')} · rev {info.get('rev')}  red=removed green=added amber=modified violet=moved", fill=(76, 195, 138), font=f)
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
