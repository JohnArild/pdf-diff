import os
HERE = os.path.dirname(os.path.abspath(__file__))
GX0,GX1,GY0,GY1=26,514,26,714
COLS,ROWS='1234','ABCDEF'
def grid():
    g=['<rect x="10" y="10" width="520" height="720" fill="none" stroke="#1f2937" stroke-width="0.8"/>',
       f'<rect x="{GX0}" y="{GY0}" width="{GX1-GX0}" height="{GY1-GY0}" fill="none" stroke="#1f2937" stroke-width="1.6"/>']
    cw=(GX1-GX0)/len(COLS); rh=(GY1-GY0)/len(ROWS)
    for i,c in enumerate(COLS):
        x=GX0+i*cw; cx=x+cw/2
        if i: g.append(f'<line x1="{x}" y1="10" x2="{x}" y2="{GY0}" stroke="#1f2937" stroke-width="0.8"/><line x1="{x}" y1="{GY1}" x2="{x}" y2="730" stroke="#1f2937" stroke-width="0.8"/>')
        for y in (21,725): g.append(f'<text x="{cx}" y="{y}" class="g">{c}</text>')
    for j,r in enumerate(ROWS):
        y=GY0+j*rh; cy=y+rh/2
        if j: g.append(f'<line x1="10" y1="{y}" x2="{GX0}" y2="{y}" stroke="#1f2937" stroke-width="0.8"/><line x1="{GX1}" y1="{y}" x2="530" y2="{y}" stroke="#1f2937" stroke-width="0.8"/>')
        for x in (18,522): g.append(f'<text x="{x}" y="{cy+3.5}" class="g">{r}</text>')
    # centring marks
    g.append('<line x1="270" y1="10" x2="270" y2="34" stroke="#1f2937" stroke-width="1.6"/><line x1="270" y1="706" x2="270" y2="730" stroke="#1f2937" stroke-width="1.6"/>')
    return ''.join(g)

def sheet(rev):
    A = rev == 'A'
    s = []
    # outer border
    s.append(grid())
    # header text
    s.append('<text x="34" y="46" class="h">GROUND FLOOR PLAN — BUILDING 2</text>')
    s.append('<text x="34" y="62" class="t">Scale 1:100 · All dimensions in mm</text>')
    # floor plan outer walls
    W='#111827'
    s.append(f'<rect x="50" y="90" width="440" height="330" fill="none" stroke="{W}" stroke-width="6"/>')
    # interior walls common
    s.append(f'<line x1="250" y1="90" x2="250" y2="300" stroke="{W}" stroke-width="3"/>')
    s.append(f'<line x1="50" y1="300" x2="200" y2="300" stroke="{W}" stroke-width="3"/>')
    s.append(f'<line x1="240" y1="300" x2="490" y2="300" stroke="{W}" stroke-width="3"/>')
    s.append(f'<line x1="370" y1="300" x2="370" y2="420" stroke="{W}" stroke-width="3"/>')
    # windows
    for x in (75,125,320,400):
        s.append(f'<rect x="{x}" y="86" width="40" height="8" fill="#fff" stroke="{W}" stroke-width="1"/><line x1="{x}" y1="90" x2="{x+40}" y2="90" stroke="{W}" stroke-width="0.8"/>')
    # door in wall 250 (common)
    s.append(f'<path d="M200 300 A40 40 0 0 1 240 260" fill="none" stroke="#6b7280" stroke-width="1" stroke-dasharray="3 2"/><line x1="200" y1="300" x2="200" y2="260" stroke="{W}" stroke-width="1.5"/>')
    # stair
    for i in range(9):
        s.append(f'<line x1="{380+i*12}" y1="320" x2="{380+i*12}" y2="400" stroke="#6b7280" stroke-width="0.8"/>')
    s.append('<rect x="380" y="320" width="96" height="80" fill="none" stroke="#6b7280" stroke-width="0.8"/>')
    # furniture table common
    s.append('<rect x="290" y="150" width="120" height="60" rx="4" fill="none" stroke="#9ca3af" stroke-width="1"/>')
    for cx in (310,350,390):
        s.append(f'<circle cx="{cx}" cy="140" r="7" fill="none" stroke="#9ca3af"/><circle cx="{cx}" cy="220" r="7" fill="none" stroke="#9ca3af"/>')
    # Room labels
    s.append('<text x="85" y="190" class="r">OPEN OFFICE</text><text x="100" y="205" class="t">2.01 · 48 m²</text>')
    lbl = 'OFFICE' if A else 'MEETING'
    s.append(f'<text x="{318 if A else 312}" y="250" class="r">{lbl}</text><text x="328" y="265" class="t">2.04 · 26 m²</text>')
    s.append('<text x="90" y="365" class="r">STORAGE</text><text x="100" y="380" class="t">2.02</text>')
    s.append('<text x="270" y="365" class="r">WC</text>')
    # dimension line bottom
    s.append('<line x1="50" y1="445" x2="250" y2="445" stroke="#374151" stroke-width="0.8"/><line x1="50" y1="438" x2="50" y2="452" stroke="#374151"/><line x1="250" y1="438" x2="250" y2="452" stroke="#374151"/><line x1="490" y1="438" x2="490" y2="452" stroke="#374151"/><line x1="250" y1="445" x2="490" y2="445" stroke="#374151" stroke-width="0.8"/>')
    s.append('<text x="135" y="440" class="t">4200</text>')
    s.append(f'<text x="355" y="440" class="t">{"4800" if A else "5100"}</text>')
    # differences
    hl=[]
    if A:
        # removed column + partition in storage
        s.append(f'<rect x="150" y="320" width="16" height="16" fill="{W}"/>')
        s.append(f'<line x1="200" y1="300" x2="200" y2="420" stroke="{W}" stroke-width="3"/>')
        hl.append('<rect x="140" y="310" width="68" height="116" rx="3" class="hr"/>')
        hl.append('<rect x="310" y="238" width="58" height="16" rx="2" class="ha"/>')
        hl.append('<rect x="350" y="428" width="34" height="16" rx="2" class="ha"/>')
    else:
        # added partition in open office
        s.append(f'<line x1="205" y1="90" x2="205" y2="220" stroke="{W}" stroke-width="3"/>')
        s.append(f'<path d="M205 220 A30 30 0 0 1 235 250" fill="none" stroke="#6b7280" stroke-width="1" stroke-dasharray="3 2"/>')
        hl.append('<rect x="195" y="96" width="50" height="160" rx="3" class="hg"/>')
        hl.append('<rect x="306" y="238" width="68" height="16" rx="2" class="ha"/>')
        hl.append('<rect x="350" y="428" width="34" height="16" rx="2" class="ha"/>')
        s.append('<text x="34" y="495" class="t">NOTE 7: New partition wall EI30 between 2.01 and 2.03.</text>')
        hl.append('<rect x="30" y="484" width="300" height="16" rx="2" class="hg"/>')
    # notes
    s.append('<text x="34" y="478" class="r">GENERAL NOTES</text>')
    for i,t in enumerate(['1. Do not scale from drawing.','2. Verify all dimensions on site.']):
        s.append(f'<text x="34" y="{515+i*15}" class="t">{t}</text>')
    # title block
    s.append('<g transform="translate(-8,-8)">')
    s.append('<rect x="290" y="580" width="232" height="142" fill="none" stroke="#1f2937" stroke-width="1"/>')
    for y in (610,640,670,700):
        s.append(f'<line x1="290" y1="{y}" x2="522" y2="{y}" stroke="#1f2937" stroke-width="0.6"/>')
    s.append('<line x1="400" y1="640" x2="400" y2="722" stroke="#1f2937" stroke-width="0.6"/>')
    s.append('<text x="298" y="600" class="r">NORDLYS ARKITEKTER AS</text>')
    s.append('<text x="298" y="630" class="t">Project: Fjordgata Office Building</text>')
    s.append('<text x="298" y="660" class="t">Drawing No. A-102</text><text x="408" y="660" class="t">Sheet 2 of 6</text>')
    s.append(f'<text x="298" y="690" class="t">Date: {"2026-08-14" if A else "2026-10-02"}</text>')
    s.append(f'<text x="408" y="690" class="r">{"REV 3" if A else "REV 4"}</text>')
    s.append('<text x="298" y="714" class="t">Drawn: JA</text><text x="408" y="714" class="t">Checked: KL</text>')
    s.append('</g>')
    hl.append('<g transform="translate(-8,-8)">')
    hl.append('<rect x="294" y="678" width="98" height="17" rx="2" class="ha"/>')
    hl.append('<rect x="404" y="678" width="46" height="17" rx="2" class="ha"/>')
    hl.append('</g>')
    # north arrow
    s.append('<g transform="translate(470,520)"><circle r="18" fill="none" stroke="#374151"/><path d="M0 -15 L6 8 L0 3 L-6 8Z" fill="#374151"/><text x="-4" y="-22" class="t">N</text></g>')
    return f'<svg viewBox="0 0 540 740" class="sheet">{"".join(s)}{"".join(hl)}</svg>'

changes = [
 ('text','mod','Title block revision','"REV 3" → "REV 4"','F4'),
 ('text','mod','Date changed','2026-08-14 → 2026-10-02','F3'),
 ('text','mod','Room 2.04 renamed','"OFFICE" → "MEETING"','B3'),
 ('text','mod','Dimension changed','4800 → 5100','D3'),
 ('vec','add','Wall added','Partition in 2.01 · 14 seg.','A2–B2'),
 ('vec','add','Door swing added','Arc at partition wall','B2'),
 ('vec','rem','Wall removed','Storage partition · 4 seg.','C2–D2'),
 ('vec','rem','Column removed','160×160 solid fill','C2'),
 ('text','add','Note added','"NOTE 7: New partition…"','E1–E3'),
]
rows=[]
for i,(k,op,title,det,ref) in enumerate(changes):
    sel=' sel' if i==0 else ''
    icon = 'T' if k=='text' else '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 11 L6 1 L11 11Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
    rows.append(f'<div class="row{sel}"><span class="dot {op}"></span><div class="rb"><div class="rt"><span class="kind">{icon}</span>{title}</div><div class="rd">{det}</div></div><span class="pg">A-102 · <b>{ref}</b></span></div>')

html = f'''<!doctype html><html><head><meta charset="utf-8"><title>PDF Diff — mockup</title><style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:1600px;height:1000px;font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0f1115;color:#e5e7eb;overflow:hidden;font-size:13px}}
.top{{height:56px;display:flex;align-items:center;padding:0 18px;gap:18px;background:#16181d;border-bottom:1px solid #262a33}}
.logo{{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;letter-spacing:.2px}}
.logo i{{width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#e5484d 0 50%,#30a46c 50% 100%);display:block;position:relative}}
.logo i:after{{content:"";position:absolute;inset:6px;border-radius:3px;background:#16181d;opacity:.85}}
.files{{display:flex;gap:10px;margin-left:14px}}
.file{{display:flex;align-items:center;gap:9px;padding:6px 12px;background:#1d2027;border:1px solid #2b303a;border-radius:8px}}
.file b{{font-weight:600;color:#f3f4f6}} .file span{{color:#9ca3af;font-size:12px}}
.tag{{font-size:11px;font-weight:700;padding:2px 7px;border-radius:5px}}
.ta{{background:rgba(229,72,77,.15);color:#ff8589}} .tb{{background:rgba(48,164,108,.16);color:#4cc38a}}
.arrow{{color:#6b7280;align-self:center}}
.sp{{flex:1}}
.seg{{display:flex;background:#1d2027;border:1px solid #2b303a;border-radius:9px;padding:3px}}
.seg div{{padding:6px 14px;border-radius:6px;color:#9ca3af;font-weight:500}}
.seg .on{{background:#2f3542;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.4)}}
.btn{{padding:8px 14px;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600}}
.btn2{{padding:8px 12px;border-radius:8px;border:1px solid #2b303a;color:#d1d5db;background:#1d2027}}
.bar{{height:46px;display:flex;align-items:center;gap:14px;padding:0 18px;background:#13151a;border-bottom:1px solid #262a33;color:#9ca3af}}
.pn{{display:flex;align-items:center;gap:8px}}
.pn .b{{width:28px;height:28px;border-radius:6px;border:1px solid #2b303a;display:flex;align-items:center;justify-content:center;color:#d1d5db}}
.pn .cur{{padding:4px 10px;border-radius:6px;background:#1d2027;border:1px solid #2b303a;color:#fff}}
.thumbs{{display:flex;gap:6px;margin-left:8px}}
.th{{width:26px;height:34px;border-radius:3px;background:#2a2e37;border:1px solid #363b46;position:relative;font-size:9px;color:#9ca3af;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px}}
.th.on{{border:2px solid #3b82f6;color:#fff}}
.th.ch:after{{content:"";position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#f5a524}}
.th.ins{{border-style:dashed;border-color:#30a46c}}
.vsep{{width:1px;height:22px;background:#2b303a}}
.main{{display:flex;height:898px}}
.panes{{flex:1;display:flex;gap:14px;padding:14px;background:#0b0d10}}
.pane{{flex:1;background:#1a1d23;border:1px solid #262a33;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}}
.ph{{height:38px;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid #262a33;color:#9ca3af;font-size:12px}}
.ph b{{color:#e5e7eb;font-weight:600}}
.pc{{flex:1;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(#22262e 1px,transparent 1px);background-size:16px 16px;position:relative}}
.sheet{{width:540px;height:740px;background:#fff;border-radius:2px;box-shadow:0 10px 30px rgba(0,0,0,.5)}}
.sheet text{{font-family:"DejaVu Sans Mono",Menlo,monospace;fill:#1f2937}}
.sheet .g{{font-size:10px;font-weight:700;text-anchor:middle;fill:#374151}}
.sheet .h{{font-size:13px;font-weight:700}} .sheet .t{{font-size:9px}} .sheet .r{{font-size:10px;font-weight:700}}
.hr{{fill:rgba(229,72,77,.12);stroke:#e5484d;stroke-width:2}}
.hg{{fill:rgba(48,164,108,.14);stroke:#30a46c;stroke-width:2}}
.ha{{fill:rgba(245,165,36,.22);stroke:#f5a524;stroke-width:1.5}}
.zoom{{position:absolute;bottom:12px;right:12px;background:rgba(22,24,29,.9);border:1px solid #2b303a;border-radius:8px;padding:5px 10px;font-size:12px;color:#d1d5db}}
.side{{width:380px;background:#16181d;border-left:1px solid #262a33;display:flex;flex-direction:column}}
.sh{{padding:16px 18px 10px}}
.sh h3{{font-size:15px;font-weight:600;color:#fff;display:flex;justify-content:space-between;align-items:center}}
.sh h3 span{{font-size:12px;color:#9ca3af;font-weight:500}}
.stats{{display:flex;gap:8px;margin-top:12px}}
.st{{flex:1;padding:8px 10px;border-radius:8px;background:#1d2027;border:1px solid #2b303a}}
.st b{{display:block;font-size:18px}} .st span{{font-size:11px;color:#9ca3af}}
.st.add b{{color:#4cc38a}} .st.rem b{{color:#ff8589}} .st.mod b{{color:#f5b84a}}
.filters{{display:flex;gap:8px;padding:6px 18px 12px;border-bottom:1px solid #262a33}}
.chip{{padding:5px 11px;border-radius:999px;border:1px solid #2b303a;color:#cbd5e1;font-size:12px;display:flex;gap:6px;align-items:center}}
.chip.on{{background:#253047;border-color:#3b82f6;color:#fff}}
.chip em{{font-style:normal;background:#2f3542;border-radius:999px;padding:0 6px;font-size:11px}}
.grp{{padding:12px 18px 6px;font-size:11px;letter-spacing:.6px;color:#6b7280;font-weight:600;text-transform:uppercase}}
.list{{flex:1;overflow:hidden}}
.row{{display:flex;gap:11px;align-items:flex-start;padding:9px 18px;border-left:3px solid transparent}}
.row.sel{{background:#1e2430;border-left-color:#3b82f6}}
.dot{{width:9px;height:9px;border-radius:50%;margin-top:4px;flex:none}}
.dot.add{{background:#30a46c}} .dot.rem{{background:#e5484d}} .dot.mod{{background:#f5a524}}
.rb{{flex:1;min-width:0}}
.rt{{color:#f3f4f6;font-weight:500;display:flex;gap:7px;align-items:center}}
.kind{{width:18px;height:18px;border-radius:4px;background:#2a2e37;color:#9ca3af;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}}
.rd{{color:#9ca3af;font-size:12px;margin-top:3px;font-family:"DejaVu Sans Mono",Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.pg{{color:#9ca3af;font-size:11px;margin-top:1px;padding:2px 7px;border-radius:5px;background:#22262e;border:1px solid #2b303a;white-space:nowrap;font-family:"DejaVu Sans Mono",Menlo,monospace}}
.pg b{{color:#e5e7eb}}
.exp{{display:flex;align-items:center;gap:0;border:1px solid #3a4150;border-radius:7px;overflow:hidden;font-size:12px;font-weight:500;color:#e5e7eb}}
.exp span{{padding:5px 10px;background:#232833}} .exp i{{font-style:normal;padding:5px 8px;background:#1b1f27;border-left:1px solid #3a4150;color:#9ca3af;font-family:"DejaVu Sans Mono",monospace}}
.grp{{display:flex;justify-content:space-between;align-items:center}}
.ov{{position:fixed;inset:0;background:rgba(5,6,8,.66);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center}}
.modal{{width:900px;background:#16181d;border:1px solid #2f3542;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}}
.mh{{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid #262a33;gap:12px}}
.mh h2{{font-size:16px;color:#fff;font-weight:600}} .mh .x{{margin-left:auto;color:#9ca3af;font-size:18px}}
.mo{{display:flex;gap:10px;padding:12px 20px;border-bottom:1px solid #262a33;color:#9ca3af;font-size:12px;align-items:center}}
.pre{{margin:16px 20px;background:#0b0d10;border:1px solid #262a33;border-radius:10px;height:560px;overflow:hidden;position:relative}}
.pre pre{{font-family:"DejaVu Sans Mono",Menlo,monospace;font-size:12px;line-height:1.55;color:#d1d5db;padding:14px 16px;white-space:pre}}
.pre:after{{content:"";position:absolute;left:0;right:0;bottom:0;height:60px;background:linear-gradient(transparent,#0b0d10)}}
.mf{{display:flex;align-items:center;gap:10px;padding:0 20px 18px;color:#6b7280;font-size:12px}}
.legend{{padding:12px 18px;border-top:1px solid #262a33;display:flex;gap:14px;font-size:12px;color:#9ca3af;flex-wrap:wrap}}
.legend span{{display:flex;align-items:center;gap:6px}}
.sw{{width:14px;height:10px;border-radius:2px;border:2px solid}}
.foot{{padding:12px 18px;border-top:1px solid #262a33;display:flex;gap:8px}}
.foot div{{flex:1;text-align:center}}
</style></head><body>
<div class="top">
 <div class="logo"><i></i>PDF Diff</div>
 <div class="files">
  <div class="file"><span class="tag ta">A</span><b>A-102_Ground_Floor.pdf</b><span>Rev 3 · 6 pages</span></div>
  <div class="arrow">→</div>
  <div class="file"><span class="tag tb">B</span><b>A-102_Ground_Floor_v2.pdf</b><span>Rev 4 · 7 pages</span></div>
 </div>
 <div class="sp"></div>
 <div class="seg"><div class="on">Side by side</div><div>Overlay</div><div>Slider</div></div>
 <div class="btn2">Sync zoom ✓</div>
 <div class="btn">Export report</div>
</div>
<div class="bar">
 <div class="pn"><div class="b">‹</div><div class="cur">Page 2 / 7</div><div class="b">›</div></div>
 <div class="thumbs"><div class="th">1</div><div class="th on ch">2</div><div class="th">3</div><div class="th ins">4</div><div class="th ch">5</div><div class="th">6</div><div class="th">7</div></div>
 <div class="vsep"></div>
 <span>Page pairing: A p.2 ↔ B p.2 · <span style="color:#4cc38a">B p.4 inserted</span></span>
 <div class="sp"></div>
 <span>Alignment offset: Δx 0.0 mm, Δy 0.0 mm</span>
 <div class="vsep"></div>
 <span>Compared in 1.4 s</span>
</div>
<div class="main">
 <div class="panes">
  <div class="pane"><div class="ph"><span class="tag ta">A</span><b>Rev 3</b> · A-102_Ground_Floor.pdf · page 2</div><div class="pc">{sheet('A')}<div class="zoom">100%</div></div></div>
  <div class="pane"><div class="ph"><span class="tag tb">B</span><b>Rev 4</b> · A-102_Ground_Floor_v2.pdf · page 2</div><div class="pc">{sheet('B')}<div class="zoom">100%</div></div></div>
 </div>
 <div class="side">
  <div class="sh"><h3>Changes <div class="exp"><span>⤓ Export list</span><i>.txt ▾</i></div></h3>
   <div class="stats"><div class="st add"><b>3</b><span>Added</span></div><div class="st rem"><b>2</b><span>Removed</span></div><div class="st mod"><b>4</b><span>Modified</span></div></div>
  </div>
  <div class="filters"><div class="chip on">All <em>9</em></div><div class="chip on">Text <em>5</em></div><div class="chip on">Graphics <em>4</em></div><div class="chip">Images <em>0</em></div></div>
  <div class="grp"><span>Sheet A-102 · page 2 · grid A–F / 1–4</span><span>9 of 23</span></div>
  <div class="list">{"".join(rows)}</div>
  <div class="legend"><span><i class="sw" style="border-color:#e5484d;background:rgba(229,72,77,.2)"></i>Removed (Rev A)</span><span><i class="sw" style="border-color:#30a46c;background:rgba(48,164,108,.2)"></i>Added (Rev B)</span><span><i class="sw" style="border-color:#f5a524;background:rgba(245,165,36,.25)"></i>Modified</span></div>
  <div class="foot"><div class="btn2">Mark reviewed</div><div class="btn2">Ignore</div></div>
 </div>
</div>
{{MODAL}}</body></html>'''
REPORT=open(os.path.join(HERE,'example-report.txt')).read()
import html as H
modal=f'''<div class="ov"><div class="modal"><div class="mh"><h2>Export change list</h2><span class="tag tb">Plain text</span><span class="x">✕</span></div>
<div class="mo"><div class="chip on">All changes <em>23</em></div><div class="chip">Current filter</div><div class="chip on">Group by sheet</div><div class="chip on">Include grid refs</div><span style="margin-left:auto">Encoding UTF-8 · 72 columns</span></div>
<div class="pre"><pre>{H.escape(REPORT)}</pre></div>
<div class="mf"><span>pdf-diff_A-102_rev3-rev4.txt · 2.1 KB</span><div class="sp"></div><div class="btn2">Copy</div><div class="btn">⤓ Download .txt</div></div></div></div>'''
open(os.path.join(HERE,'mockup.html'),'w').write(html.replace('{MODAL}',''))
open(os.path.join(HERE,'export-preview.html'),'w').write(html.replace('{MODAL}',modal))
