#!/usr/bin/env python3
"""Generate synthetic PDF pairs with known ground truth for the PDF Diff prototype.

Self-drawn A4-landscape sheets with an ISO (1..8 left->right, A..F top->bottom)
or ASME (8..1 left->right, F..A top->bottom, A at the bottom) border grid, plus
pairs derived from the OpenHornet OHC0003 rev A sheets in ../samples/ (run
../fetch_samples.sh first; derived PDFs are generated on the fly, never committed).

Writes  <out>/<case>/A.pdf, B.pdf and <out>/cases.json (expected changes).
"""
import json, math, os, sys, copy
import pymupdf

W, H, M = 842, 595, 30           # page, inner frame margin
NC, NR = 8, 6
CW, RH = (W - 2*M) / NC, (H - 2*M) / NR
BLACK, RED = (0, 0, 0), (0.85, 0.1, 0.1)

def labels(grid):
    cols = [str(i+1) for i in range(NC)]
    rows = [chr(ord('A')+i) for i in range(NR)]
    if grid == 'asme':
        cols = cols[::-1]; rows = rows[::-1]
    return cols, rows

def cell(grid, x, y):
    cols, rows = labels(grid)
    c = min(NC-1, max(0, int((x-M)//CW))); r = min(NR-1, max(0, int((y-M)//RH)))
    return rows[r] + cols[c]

# ------------------------------------------------------------------ base content
BASE = dict(
    notes=dict(x=45, y=55, lines=['NOTES:', '1. DEBURR ALL EDGES.', '2. FINISH: CLEAR ANODIZE.', '3. TOLERANCES ISO 2768-m.']),
    bracket=dict(cx=190, cy=190, rot=0, scale=1.0),
    circle=dict(cx=480, cy=300, r=30),
    rect=dict(cx=650, cy=200, w=80, h=40, scale=1.0),
    hexagon=dict(cx=330, cy=420, r=30, rot=0),
    dim=dict(x0=420, x1=520, y=470, text='100.0'),
    lines=[dict(y=110, color=BLACK, width=0.5, dashes=None),
           dict(y=125, color=BLACK, width=0.5, dashes=None),
           dict(y=140, color=BLACK, width=0.5, dashes='[4 2] 0')],
    shift=(0, 0),
    split=False,       # draw same geometry with different segmentation
)

def T(p, s):          # apply sheet shift
    return pymupdf.Point(p[0]+s[0], p[1]+s[1])

def polyline(shape, pts, s, closed=True, split=False):
    pts = [T(p, s) for p in pts]
    if closed: pts = pts + [pts[0]]
    if split:          # every edge as two separate line segments
        for a, b in zip(pts, pts[1:]):
            m = pymupdf.Point((a.x+b.x)/2, (a.y+b.y)/2)
            shape.draw_line(a, m); shape.draw_line(m, b)
    else:
        shape.draw_polyline(pts)

def circle(shape, c, r, s, split=False):
    if split:          # 96-gon instead of Bezier circle
        pts = [(c[0]+r*math.cos(2*math.pi*i/96), c[1]+r*math.sin(2*math.pi*i/96)) for i in range(96)]
        polyline(shape, pts, s)
    else:
        shape.draw_circle(T(c, s), r)

def xf(pts, cx, cy, rot=0, scale=1.0):
    a = math.radians(rot); out = []
    for x, y in pts:
        x, y = (x-cx)*scale, (y-cy)*scale
        out.append((cx + x*math.cos(a) - y*math.sin(a), cy + x*math.sin(a) + y*math.cos(a)))
    return out

def draw_sheet(page, grid, c):
    s = c['shift']; sp = c['split']
    sh = page.new_shape()
    # frame + grid zone ticks
    sh.draw_rect(pymupdf.Rect(T((10, 10), s), T((W-10, H-10), s)))
    sh.draw_rect(pymupdf.Rect(T((M, M), s), T((W-M, H-M), s)))
    for i in range(1, NC):
        x = M + i*CW
        sh.draw_line(T((x, 10), s), T((x, M), s)); sh.draw_line(T((x, H-M), s), T((x, H-10), s))
    for j in range(1, NR):
        y = M + j*RH
        sh.draw_line(T((10, y), s), T((M, y), s)); sh.draw_line(T((W-M, y), s), T((W-10, y), s))
    sh.finish(color=BLACK, width=0.8)
    cols, rows = labels(grid)
    for i, l in enumerate(cols):
        x = M + (i+0.5)*CW - 3
        for y in (24, H-16): page.insert_text(T((x, y), s), l, fontsize=10)
    for j, l in enumerate(rows):
        y = M + (j+0.5)*RH + 3.5
        for x in (16, W-24): page.insert_text(T((x, y), s), l, fontsize=10)
    # title block
    tb = (600, 500, 812, 565)
    sh.draw_rect(pymupdf.Rect(T(tb[:2], s), T(tb[2:], s)))
    sh.draw_line(T((600, 520), s), T((812, 520), s)); sh.draw_line(T((712, 500), s), T((712, 565), s)); sh.draw_line(T((772, 500), s), T((772, 565), s))
    sh.finish(color=BLACK, width=0.8)
    for x, y, t, fs in [(604, 512, 'DWG NO', 7), (716, 512, 'SHEET', 7), (776, 512, 'REV', 7),
                        (604, 548, 'TST-001', 14), (716, 548, '1/1', 14), (776, 548, 'A', 14)]:
        page.insert_text(T((x, y), s), t, fontsize=fs)
    # notes
    n = c['notes']
    for k, t in enumerate(n['lines']):
        page.insert_text(T((n['x'], n['y'] + 12*k), s), t, fontsize=9)
    # bracket (L-shape) with hole
    b = c['bracket']; cx, cy = b['cx'], b['cy']
    L = [(cx-40, cy-40), (cx-15, cy-40), (cx-15, cy+15), (cx+40, cy+15), (cx+40, cy+40), (cx-40, cy+40)]
    polyline(sh, xf(L, cx, cy, b['rot'], b['scale']), s, split=sp)
    hc = xf([(cx-27, cy+27)], cx, cy, b['rot'], b['scale'])[0]
    circle(sh, hc, 7*b['scale'], s, split=sp)
    # circle part
    ci = c['circle']; circle(sh, (ci['cx'], ci['cy']), ci['r'], s, split=sp)
    sh.draw_line(T((ci['cx']-ci['r']-5, ci['cy']), s), T((ci['cx']+ci['r']+5, ci['cy']), s))
    # rectangle
    r = c['rect']; w, h = r['w']*r['scale']/2, r['h']*r['scale']/2
    polyline(sh, [(r['cx']-w, r['cy']-h), (r['cx']+w, r['cy']-h), (r['cx']+w, r['cy']+h), (r['cx']-w, r['cy']+h)], s, split=sp)
    # hexagon
    hx = c['hexagon']
    P = [(hx['cx'] + hx['r']*math.cos(math.radians(60*i + hx['rot'])), hx['cy'] + hx['r']*math.sin(math.radians(60*i + hx['rot']))) for i in range(6)]
    polyline(sh, P, s, split=sp)
    sh.finish(color=BLACK, width=0.7)
    # dimension
    d = c['dim']; y = d['y']
    sh.draw_line(T((d['x0'], y), s), T((d['x1'], y), s))
    for x in (d['x0'], d['x1']): sh.draw_line(T((x, y-8), s), T((x, y+8), s))
    sh.finish(color=BLACK, width=0.5)
    for x, sg in ((d['x0'], 1), (d['x1'], -1)):
        sh.draw_polyline([T((x, y), s), T((x+sg*7, y-2.5), s), T((x+sg*7, y+2.5), s), T((x, y), s)])
    sh.finish(color=BLACK, fill=BLACK, width=0.3)
    page.insert_text(T(((d['x0']+d['x1'])/2 - 12, y-5), s), d['text'], fontsize=9)
    # style lines
    for ln in c['lines']:
        sh.draw_line(T((420, ln['y']), s), T((560, ln['y']), s))
        sh.finish(color=ln['color'], width=ln['width'], dashes=ln['dashes'])
    sh.commit()

def write(path, grid, c):
    doc = pymupdf.open(); page = doc.new_page(width=W, height=H)
    draw_sheet(page, grid, c); doc.save(path, garbage=3, deflate=True)

def variant(**kw):
    c = copy.deepcopy(BASE)
    for k, v in kw.items():
        if isinstance(v, dict) and isinstance(c.get(k), dict): c[k].update(v)
        else: c[k] = v
    return c

def exp(kind, grid, a=None, b=None, note=''):
    return dict(kind=kind, cellA=cell(grid, *a) if a else None, cellB=cell(grid, *b) if b else None, note=note)

def cases():
    C = []
    g = 'iso'
    C.append(dict(name='01_move_large', grid=g, desc='Bracket moved +50 pt in x', B=variant(bracket=dict(cx=240)),
                  expect=[exp('moved', g, (190, 190), (240, 190), 'dx=+50')]))
    for i, d in enumerate((0.5, 2, 5)):
        g = 'asme'
        C.append(dict(name=f'02{"abc"[i]}_move_{d}pt', grid=g, desc=f'Circle moved +{d} pt in x and y',
                      B=variant(circle=dict(cx=480+d, cy=300+d)),
                      expect=[] if d < 1 else [exp('moved', g, (480, 300), (480+d, 300+d), f'dx=dy=+{d}')],
                      note='below 1 pt tolerance: not expected to be detected' if d < 1 else ''))
    g = 'iso'
    C.append(dict(name='03_resize', grid=g, desc='Circle radius +10 %, rectangle scaled 1.2x about centre',
                  B=variant(circle=dict(r=33), rect=dict(scale=1.2)),
                  expect=[exp('resized', g, (480, 300), (480, 300), 'x1.10'), exp('resized', g, (650, 200), (650, 200), 'x1.20')]))
    g = 'asme'
    C.append(dict(name='04_dimension', grid=g, desc='Dimension 100.0 -> 120.0 with extension line moved',
                  B=variant(dim=dict(x1=540, text='120.0')),
                  expect=[exp('text', g, (470, 470), (480, 470), 'text 100.0 -> 120.0'),
                          exp('geometry', g, (520, 470), (540, 470), 'extension line + arrow moved +20')]))
    g = 'iso'
    C.append(dict(name='05_text_moved', grid=g, desc='Notes block moved +60 pt down',
                  B=variant(notes=dict(y=115)),
                  expect=[exp('moved', g, (90, 70), (90, 130), 'text dy=+60')]))
    g = 'asme'
    C.append(dict(name='06_rotated', grid=g, desc='Hexagon rotated 15 deg, bracket rotated 90 deg',
                  B=variant(hexagon=dict(rot=15), bracket=dict(rot=90)),
                  expect=[exp('rotated', g, (330, 420), (330, 420), '15 deg (hexagon: 6-fold symmetric, 15 == -45)'),
                          exp('rotated', g, (190, 190), (190, 190), '90 deg')]))
    g = 'iso'
    C.append(dict(name='07_sheet_shift', grid=g, desc='Whole sheet (frame, grid, all content) shifted by (+3, -2) pt',
                  B=variant(shift=(3, -2)), expect=[], note='should be compensated by page alignment'))
    g = 'asme'
    C.append(dict(name='08_style_only', grid=g, desc='Line 1 colour black->red, line 2 width 0.5->1.5, line 3 dash pattern changed',
                  B=variant(lines=[dict(y=110, color=RED, width=0.5, dashes=None), dict(y=125, color=BLACK, width=1.5, dashes=None),
                                   dict(y=140, color=BLACK, width=0.5, dashes='[8 3] 0')]),
                  expect=[exp('style', g, (490, 110), (490, 110), 'colour'), exp('style', g, (490, 125), (490, 125), 'width'),
                          exp('style', g, (490, 140), (490, 140), 'dash')]))
    g = 'iso'
    C.append(dict(name='09_negative_resegmented', grid=g, desc='Identical geometry, every edge split in two, circles as 96-gons instead of Beziers',
                  B=variant(split=True), expect=[], note='negative control'))
    return C

# ------------------------------------------------------------------ OpenHornet-derived
def oh_cases(samples):
    src = os.path.join(samples, 'OHC0003_revA_v29.pdf')
    if not os.path.exists(src): return []
    return [
        dict(name='10_oh_view_moved', grid=None, desc='OHC0003 sheet 22: top view "VIEW A-A" (geometry + text) moved +60 pt right', oh=('move', 21, (85, 20, 345, 200), (60, 0)),
             expect=[dict(kind='moved', cellA=None, cellB=None, note='dx=+60, no grid on sheet')]),
        dict(name='11_oh_sheet_shift', grid='oh', desc='OHC0003 sheet 1 (D-size, ASME grid) re-placed with (+4, +3) pt offset', oh=('shift', 0, None, (4, 3)),
             expect=[], note='should be compensated by page alignment'),
        dict(name='12_oh_negative_rewrapped', grid='oh', desc='OHC0003 sheet 1 re-wrapped as a Form XObject (different content stream, same geometry)', oh=('wrap', 0, None, (0, 0)),
             expect=[], note='negative control'),
    ]

def write_oh(case, samples, outdir):
    src = pymupdf.open(os.path.join(samples, 'OHC0003_revA_v29.pdf'))
    kind, pno, rect, (dx, dy) = case['oh']
    a = pymupdf.open(); a.insert_pdf(src, from_page=pno, to_page=pno); a.save(os.path.join(outdir, 'A.pdf'), garbage=3, deflate=True)
    pr = src[pno].rect
    b = pymupdf.open(); p = b.new_page(width=pr.width, height=pr.height)
    if kind in ('shift', 'wrap'):
        p.show_pdf_page(pr + (dx, dy, dx, dy), src, pno)
    elif kind == 'move':
        # place the original sheet several times with rectangular clips: the complement of the
        # view region in place, and the view region itself shifted by (dx, dy)
        r = pymupdf.Rect(rect)
        for cut in (pymupdf.Rect(0, 0, pr.width, r.y0), pymupdf.Rect(0, r.y1, pr.width, pr.height),
                    pymupdf.Rect(0, r.y0, r.x0, r.y1), pymupdf.Rect(r.x1, r.y0, pr.width, r.y1)):
            p.show_pdf_page(cut, src, pno, clip=cut)
        p.show_pdf_page(r + (dx, dy, dx, dy), src, pno, clip=r)
    b.save(os.path.join(outdir, 'B.pdf'), garbage=3, deflate=True)

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'out')
    samples = os.path.join(here, '..', 'samples')
    os.makedirs(out, exist_ok=True)
    allc = []
    for c in cases():
        d = os.path.join(out, c['name']); os.makedirs(d, exist_ok=True)
        write(os.path.join(d, 'A.pdf'), c['grid'], BASE); write(os.path.join(d, 'B.pdf'), c['grid'], c['B'])
        c = {k: v for k, v in c.items() if k != 'B'}; allc.append(c)
    for c in oh_cases(samples):
        d = os.path.join(out, c['name']); os.makedirs(d, exist_ok=True)
        write_oh(c, samples, d); allc.append({k: v for k, v in c.items() if k != 'oh'})
    json.dump(allc, open(os.path.join(out, 'cases.json'), 'w'), indent=1)
    print(f'{len(allc)} cases written to {out}')
