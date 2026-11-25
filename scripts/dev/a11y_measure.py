"""WCAG 2.2 AA measurer for the Karmi Laven storefront (Playwright, real browser, getBoundingClientRect).

  py -3 scripts/dev/a11y_measure.py BASE_URL [--json out.json]

Run it against `node scripts/dev/serve.mjs --port N` (flag OFF) and `... --families` (flag ON). For every viewport
(390x844, 1280x800) it walks the page states (home, every family tab, product modal, bundle, bag with 9 items) and reports:
  1 min text size px (+ elements below the floor: 12 px everywhere, 14 px on card name / card price / hero single price)
  2 min text contrast (4.5, 3.0 for large text) and min border contrast of bordered controls (3.0)
  3 smallest tap target (44x44), links inside a sentence are exempt (WCAG 2.5.8 inline exception) and counted apart
  4 unnamed controls (aria-label / labelledby / title / text / img alt / label / value)
  5 reduced motion: transitions, animations, scroll-behavior under prefers-reduced-motion: reduce
  6 help bubble: a simulated 56x56 fixed bubble 16 px from the bottom-right corner vs every text line + control in the open bag
Same method as K&D's tools/kd_karmi_pct_a11y.py and kd_karmi_bag_line_a11y.py (computed style + WCAG luminance formula).
"""
import json, sys
from playwright.sync_api import sync_playwright

JS_HELPERS = r"""
window.__a = (function(){
const lumOf=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
const parse=s=>{const m=(s.match(/[\d.]+/g)||[]).map(Number);return m.length<3?[0,0,0,0]:[m[0],m[1],m[2],m.length>3?m[3]:1];};
const over=(f,b)=>{const a=f[3];return [f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1];};
const ratio=(a,b)=>{const x=lumOf(a),y=lumOf(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
function bgOf(e){const chain=[];for(let x=e;x&&x.nodeType===1;x=x.parentElement){const cs=getComputedStyle(x);
  if(cs.backgroundImage&&cs.backgroundImage!=='none') {chain.push('IMG');break;}
  const c=parse(cs.backgroundColor); if(c[3]>0) chain.push(c); if(c[3]>=1) break;}
  let base=[255,255,255,1]; for(let i=chain.length-1;i>=0;i--){ if(chain[i]==='IMG') return null; base=over(chain[i],base);} return base;}
function opac(e){let o=1;for(let x=e;x&&x.nodeType===1;x=x.parentElement) o*=parseFloat(getComputedStyle(x).opacity);return o;}
const CLOSED='.cart:not(.open), .modal:not(.open), .bundle:not(.open), .klpop:not(.open), .ovl, .klpop-ovl';
function shown(e,withOpacity){ if(window.__dialog&&!e.closest(window.__dialog)) return false; if(!e.checkVisibility({checkOpacity:!!withOpacity,checkVisibilityCSS:true})) return false; if(e.closest(CLOSED)) return false;
  const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) return false; return true;}
const lab=e=>{const t=(e.innerText||e.value||e.getAttribute('aria-label')||e.id||'').toString().trim().replace(/\s+/g,' ').slice(0,38);
  return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'')+' "'+t+'"';};
function textNodes(root){const out=[];const w=document.createTreeWalker(root||document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=w.nextNode()){if(!/\S/.test(n.textContent))continue;const e=n.parentElement;if(!e||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName))continue;if(!shown(e,true))continue;out.push(n);}return out;}
function overImg(e){const y0=scrollY;let q=e.getBoundingClientRect();let moved=false;
  if(q.top<0||q.bottom>innerHeight){window.scrollTo({top:Math.max(0,y0+q.top-innerHeight/2),behavior:'instant'});moved=true;q=e.getBoundingClientRect();}
  let hit=false;if(q.top>=0&&q.bottom<=innerHeight){const cx=Math.min(innerWidth-1,Math.max(0,q.left+q.width/2)),cy=q.top+q.height/2;const st=document.elementsFromPoint(cx,cy);const i=st.indexOf(e);
    for(const o of st.slice(i<0?0:i+1)){ if(o.contains(e))continue; if(/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(o.tagName)||getComputedStyle(o).backgroundImage!=='none'){hit=true;break;} }}
  if(moved) window.scrollTo({top:y0,behavior:'instant'}); return hit;}
function textStats(){const rows=[];
  for(const n of textNodes()){const e=n.parentElement,cs=getComputedStyle(e),px=parseFloat(cs.fontSize);
    let bg=bgOf(e);
    let cr=null,large=px>=24||(px>=18.66&&parseInt(cs.fontWeight)>=700);
    if(bg){const fg=parse(cs.color);fg[3]*=opac(e);cr=ratio(over(fg,bg),bg); if(cr<(large?3:4.5)&&overImg(e)) cr=null;}
    const cls=(e.closest('.card .nm,.cbody .nm,.cbody .pr,.kl-hp-single')?1:0), pr=/£|delivery|free|each|ship/i.test(n.textContent);
    if(cr===null){e.setAttribute('data-a11y-img','1');} rows.push({el:lab(e),px,cr:cr===null?null:Math.round(cr*100)/100,large,txt:n.textContent.trim().slice(0,40),card:cls,price:pr});}
  return rows;}
const INTER='a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[role=checkbox],[role=radio],[onclick]';
function isInline(e){ if(e.tagName!=='A')return false; const cs=getComputedStyle(e); if(cs.display!=='inline')return false;
  const p=e.parentElement; return !!p && (p.textContent||'').replace(/\s+/g,' ').trim().length>(e.textContent||'').trim().length+6; }
function targets(){const rows=[];document.querySelectorAll(INTER).forEach(e=>{ if(!shown(e,false))return; if(e.closest('[hidden]'))return;
  const r=e.getBoundingClientRect(); rows.push({el:lab(e),w:Math.round(r.width*10)/10,h:Math.round(r.height*10)/10,inline:isInline(e)});});return rows;}
function nameOf(e){
  const lb=e.getAttribute('aria-labelledby'); if(lb){const t=lb.split(/\s+/).map(i=>{const x=document.getElementById(i);return x?x.textContent:'';}).join(' ').trim(); if(t) return t;}
  const al=(e.getAttribute('aria-label')||'').trim(); if(al) return al;
  if(e.tagName==='INPUT'&&/^(button|submit|reset)$/.test(e.type)&&e.value) return e.value;
  if(e.labels&&e.labels.length){const t=Array.from(e.labels).map(l=>l.textContent).join(' ').trim(); if(t) return t;}
  const t=(e.textContent||'').trim(); if(t&&!/^[\s​]*$/.test(t)) return t;
  const im=e.querySelector('img[alt]'); if(im&&im.alt.trim()) return im.alt; const ri=e.querySelector('[role=img][aria-label]'); if(ri) return ri.getAttribute('aria-label');
  const ti=(e.getAttribute('title')||'').trim(); if(ti) return ti; return '';}
function unnamed(){const rows=[];document.querySelectorAll(INTER).forEach(e=>{ if(!e.checkVisibility({checkVisibilityCSS:true})) return;
  if(e.closest('[aria-hidden=true]')||e.closest('[inert]')) return;
  if(e.hasAttribute('onclick')&&!/^(a|button|input|select|textarea|summary)$/i.test(e.tagName)&&!e.getAttribute('role')&&!e.hasAttribute('tabindex')) return;
  if(!nameOf(e)) rows.push(lab(e));});return rows;}
function weak(){const rows=[];document.querySelectorAll('button,[role=button],a[href]').forEach(e=>{ if(!e.checkVisibility({checkVisibilityCSS:true})) return;
  if((e.getAttribute('aria-label')||'').trim()) return; const t=(e.textContent||'').trim(); if(t&&/^[\W_]{1,3}$/u.test(t)) rows.push(lab(e));});return rows;}
function borders(){const rows=[];document.querySelectorAll('button,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,[role=tab],.sw,textarea').forEach(e=>{
  if(!shown(e,false))return; const cs=getComputedStyle(e); if(parseFloat(cs.borderTopWidth)<1||cs.borderTopStyle==='none')return;
  const bgc=parse(cs.backgroundColor); if(bgc[3]>=0.99) return;
  const par=bgOf(e.parentElement); if(!par)return; const bc=parse(cs.borderTopColor); if(bc[3]===0)return;
  rows.push({el:lab(e),cr:Math.round(ratio(over(bc,par),par)*100)/100});});return rows;}
function motion(){const bad=[];const all=[document.documentElement,...document.querySelectorAll('*')];
  const sec=s=>Math.max(0,...String(s).split(',').map(x=>parseFloat(x)*(/ms\s*$/.test(x)?0.001:1)||0));
  for(const e of all){for(const ps of [null,'::before','::after']){const cs=getComputedStyle(e,ps); if(ps&&(cs.content==='none'||cs.content==='normal'))continue;
    const td=sec(cs.transitionDuration)+sec(cs.transitionDelay), an=cs.animationName!=='none'?sec(cs.animationDuration)+sec(cs.animationDelay):0;
    if(td>0.001) bad.push('transition '+lab(e)+(ps||'')+' '+cs.transitionDuration);
    if(an>0.001) bad.push('animation '+lab(e)+(ps||'')+' '+cs.animationName+' '+cs.animationDuration+' delay '+cs.animationDelay);}
    if(getComputedStyle(e).scrollBehavior==='smooth') bad.push('scroll-behavior:smooth '+lab(e));}
  return bad;}
function lineRects(root){const out=[];for(const n of textNodes(root)){const r=document.createRange();r.selectNodeContents(n);for(const q of r.getClientRects()) if(q.width>1&&q.height>1) out.push({t:n.textContent.trim().slice(0,30),l:q.left,t0:q.top,r:q.right,b:q.bottom});}
  root.querySelectorAll(INTER).forEach(e=>{ if(!shown(e,false))return; const q=e.getBoundingClientRect(); out.push({t:'['+lab(e)+']',l:q.left,t0:q.top,r:q.right,b:q.bottom});}); return out;}
function bubbleOverlap(){let b=document.getElementById('__bubble'); if(!b){b=document.createElement('div');b.id='__bubble';b.setAttribute('aria-hidden','true');
  b.style.cssText='position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:50%;background:#000;z-index:2147483647;pointer-events:none';document.body.appendChild(b);}
  const q=b.getBoundingClientRect(); const hits=[]; const cart=document.getElementById('cart');
  const cb=document.getElementById('cookie-banner'); const roots=[cart].concat(cb&&cb.checkVisibility()?[cb]:[]);
  for(const r of roots.flatMap(x=>lineRects(x))){ if(r.r>q.left&&r.l<q.right&&r.b>q.top&&r.t0<q.bottom) hits.push(r.t); }
  return {bubble:[Math.round(q.left),Math.round(q.top),Math.round(q.right),Math.round(q.bottom)],hits};}
return {textStats,targets,unnamed,weak,borders,motion,bubbleOverlap};})();
"""

def state_open(pg, name):
    if name == 'modal':
        pg.evaluate("()=>{const d=(window.DATA||[])[0]; if(d) openModal(d.barcode)}")
    elif name == 'bundle':
        pg.evaluate("()=>{openBundle()}")
    elif name == 'bag':
        pg.evaluate("""()=>{const d=(DATA.find(x=>typeof LADDER_TYPES!=='undefined'&&LADDER_TYPES.includes(x.type))||DATA[0]);
          cart.length=0; cart.push({bc:d.barcode,qty:9}); try{updateBag()}catch(e){}; openCart();}""")
    pg.wait_for_timeout(700)

def state_close(pg, name):
    pg.evaluate("""(n)=>{try{ if(n==='modal') closeModal(); if(n==='bundle') closeBundle(); if(n==='bag'){ closeCart(); cart.length=0; updateBag(); } }catch(e){} }""", name)
    pg.wait_for_timeout(500)

def img_contrast(pg, cap=40):
    """Text over a photo/gradient: hide the glyphs, screenshot the box, worst 10 % of background pixels (rounded-corner pixels of pills are ~5 %) vs the text colour."""
    from PIL import Image
    import io
    def lum(c):
        f = lambda v: (v / 255 / 12.92) if v / 255 <= 0.03928 else (((v / 255) + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
    out = []
    n = pg.evaluate("()=>document.querySelectorAll('[data-a11y-img]').length")
    seen = set()
    for i in range(min(n, 400)):
        info = pg.evaluate(r"""async (i)=>{const e=document.querySelectorAll('[data-a11y-img]')[i]; if(!e) return null; e.scrollIntoView({block:'center',behavior:'instant'}); await new Promise(r=>setTimeout(r,200));
          const r=e.getBoundingClientRect(), cs=getComputedStyle(e); const m=cs.color.match(/[\d.]+/g).map(Number); const px=parseFloat(cs.fontSize);
          return {t:(e.innerText||'').trim().slice(0,30), cls:e.tagName+'.'+String(e.className).slice(0,30), x:r.left,y:r.top,w:r.width,h:r.height, fg:m, large:px>=24||(px>=18.66&&parseInt(cs.fontWeight)>=700), px}}""", i)
        if not info or info['w'] < 2 or info['h'] < 2:
            continue
        key = info['cls'] + info['t']
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > cap:
            break
        pg.evaluate("(i)=>{const e=document.querySelectorAll('[data-a11y-img]')[i]; e.setAttribute('data-a11y-hide','1'); if(!document.getElementById('__hide')){const st=document.createElement('style');st.id='__hide';st.textContent='[data-a11y-hide],[data-a11y-hide] *{color:transparent !important;text-shadow:none !important;-webkit-text-fill-color:transparent !important}';document.head.appendChild(st);}}", i)
        pg.wait_for_timeout(60)
        try:
            png = pg.query_selector_all('[data-a11y-img]')[i].screenshot()
            im = Image.open(io.BytesIO(png)).convert('RGB')
            W, H = im.size   # centre box only: rounded-corner pixels of a pill are not what the text sits on
            px = list(im.crop((int(W * .12), int(H * .2), max(int(W * .12) + 1, int(W * .88)), max(int(H * .2) + 1, int(H * .8)))).getdata())
        except Exception:
            px = []
        pg.evaluate("(i)=>{const e=document.querySelectorAll('[data-a11y-img]')[i]; e.removeAttribute('data-a11y-hide');}", i)
        if not px:
            continue
        fg = info['fg'][:3]
        a = info['fg'][3] if len(info['fg']) > 3 else 1
        ratios = []
        for c in px[::max(1, len(px) // 400)]:
            col = [fg[k] * a + c[k] * (1 - a) for k in range(3)]
            l1, l2 = lum(col), lum(c)
            ratios.append((max(l1, l2) + 0.05) / (min(l1, l2) + 0.05))
        ratios.sort()
        out.append({'t': info['t'], 'cls': info['cls'], 'cr': round(ratios[max(0, int(len(ratios) * 0.10))], 2), 'large': info['large'], 'px': info['px']})
    pg.evaluate("()=>document.querySelectorAll('[data-a11y-img]').forEach(e=>e.removeAttribute('data-a11y-img'))")
    return out

def collect(pg):
    return pg.evaluate("""()=>({text:__a.textStats(), targets:__a.targets(), unnamed:__a.unnamed(), weak:__a.weak(), borders:__a.borders()})""")

def run(url):
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for vw, vh in [(390, 844), (1280, 800)]:
            res = {'font_floor': [], 'min_px': None, 'min_cr': None, 'min_cr_large': None, 'min_border': None, 'min_target': None,
                   'target_fail': [], 'inline_small': 0, 'unnamed': [], 'weak': [], 'motion': None, 'bubble': None, 'img_bg_text': 0, 'states': [], 'min_img': None}
            ctx = b.new_context(viewport={'width': vw, 'height': vh})
            pg = ctx.new_page(); pg.goto(url, wait_until='networkidle'); pg.wait_for_timeout(2500); pg.evaluate(JS_HELPERS)
            res['flag_families'] = pg.evaluate("()=>document.documentElement.classList.contains('kl-v2')")
            ntabs = pg.evaluate("()=>document.querySelectorAll('.kl-tabs [role=tab]').length")
            states = [('home', None)] + [('tab:%d' % i, i) for i in range(1, ntabs)] + [('modal', 'modal'), ('bundle', 'bundle'), ('bag', 'bag')]
            for sname, arg in states:
                if sname.startswith('tab:'):
                    pg.evaluate("(i)=>{const e=document.querySelectorAll('.kl-tabs [role=tab]')[i]; if(e) e.click();}", arg); pg.wait_for_timeout(700)
                elif arg:
                    try: state_open(pg, arg)
                    except Exception as e: res['states'].append(sname + ' ERR ' + str(e)[:60]); continue
                pg.evaluate("(s)=>{window.__dialog=s}", {'modal': '.modal.open', 'bundle': '.bundle.open', 'bag': '.cart.open'}.get(arg))
                c = collect(pg); res['states'].append(sname)
                for t in img_contrast(pg):
                    res.setdefault('img_text', []).append('%s: %.2f %s [%s] %spx' % (sname, t['cr'], t['cls'], t['t'], t['px']))
                    need = 3.0 if t['large'] else 4.5
                    if t['cr'] < need:
                        res.setdefault('img_fail', []).append('%s: %.2f (need %.1f) %s [%s]' % (sname, t['cr'], need, t['cls'], t['t']))
                    if res['min_img'] is None or t['cr'] < res['min_img'][0]:
                        res['min_img'] = (t['cr'], t['cls'], t['t'], sname)
                for t in c['text']:
                    if t['cr'] is None: res['img_bg_text'] += 1
                    floor = 14 if (t['card'] and t['price']) else 12
                    if t['px'] < floor - 0.01: res['font_floor'].append('%s: %.1fpx (%s) [%s]' % (sname, t['px'], t['el'], t['txt']))
                    if res['min_px'] is None or t['px'] < res['min_px'][0]: res['min_px'] = (round(t['px'], 2), t['el'], sname)
                    if t['cr'] is not None:
                        k = 'min_cr_large' if t['large'] else 'min_cr'
                        if res[k] is None or t['cr'] < res[k][0]: res[k] = (t['cr'], t['el'], sname, t['px'])
                        need = 3.0 if t['large'] else 4.5
                        if t['cr'] < need: res.setdefault('cr_fail', []).append('%s: %.2f (need %.1f) %s [%s]' % (sname, t['cr'], need, t['el'], t['txt']))
                for t in c['borders']:
                    if res['min_border'] is None or t['cr'] < res['min_border'][0]: res['min_border'] = (t['cr'], t['el'], sname)
                    if t['cr'] < 3.0: res.setdefault('border_fail', []).append('%s: %.2f %s' % (sname, t['cr'], t['el']))
                for t in c['targets']:
                    if t['inline']:
                        if min(t['w'], t['h']) < 24: res['inline_small'] += 1
                        continue
                    m = min(t['w'], t['h'])
                    if res['min_target'] is None or m < res['min_target'][0]: res['min_target'] = (m, t['el'], '%sx%s' % (t['w'], t['h']), sname)
                    if t['w'] < 43.99 or t['h'] < 43.99: res['target_fail'].append('%s: %sx%s %s' % (sname, t['w'], t['h'], t['el']))
                res['unnamed'] += [sname + ': ' + u for u in c['unnamed']]
                res['weak'] += [sname + ': ' + u for u in c['weak']]
                pg.evaluate("()=>{window.__dialog=null}")
                if sname == 'bag':
                    res['bubble'] = pg.evaluate("()=>__a.bubbleOverlap()")
                if arg and not sname.startswith('tab:'):
                    state_close(pg, arg)
            ctx.close()
            ctx2 = b.new_context(viewport={'width': vw, 'height': vh}, reduced_motion='reduce')
            pg2 = ctx2.new_page(); pg2.goto(url, wait_until='networkidle'); pg2.wait_for_timeout(2500); pg2.evaluate(JS_HELPERS)
            mo = pg2.evaluate("()=>__a.motion()")
            try:
                state_open(pg2, 'bag'); mo += pg2.evaluate("()=>__a.motion()")
            except Exception: pass
            res['motion'] = sorted(set(mo)); ctx2.close()
            for k in ('font_floor', 'target_fail', 'unnamed', 'weak', 'cr_fail', 'border_fail', 'img_fail', 'img_text'): res[k] = sorted(set(res.get(k, [])))
            out['%dx%d' % (vw, vh)] = res
        b.close()
    return out

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    r = run(sys.argv[1])
    if '--json' in sys.argv:
        open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8').write(json.dumps(r, indent=1, ensure_ascii=False))
    for vp, x in r.items():
        print('==', vp, 'families view:', x['flag_families'], 'states:', ','.join(x['states']))
        print(' min font px      :', x['min_px'], '| below floor:', len(x['font_floor']))
        print(' min contrast text:', x['min_cr'], '| large:', x['min_cr_large'], '| fails:', len(x['cr_fail']), '| text on image/gradient skipped:', x['img_bg_text'])
        print(' text over photo   : worst-10%% pixels min %s | fails: %d' % (x['min_img'], len(x['img_fail'])))
        print(' min border contr :', x['min_border'], '| fails:', len(x['border_fail']))
        print(' min tap target   :', x['min_target'], '| <44:', len(x['target_fail']), '| inline links <24:', x['inline_small'])
        print(' unnamed controls :', len(x['unnamed']), '| glyph-only names:', len(x['weak']))
        print(' reduced motion   :', 'OK' if not x['motion'] else 'NOT OK (%d)' % len(x['motion']))
        print(' bubble overlap   :', x['bubble'])
