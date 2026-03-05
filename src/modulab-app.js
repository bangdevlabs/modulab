/* =====================================================
   modulab-app.js — liga UI ↔ core/canvas/io
   - Palette UI, Pattern 8×8, Dither/Stencil
   - Topbar (size/zoom/grid/wrap/onion)
   - Timeline thumbs + playback rAF
   - Git bridge (projects/pieces/sprites) por box
   ===================================================== */

import {
  $, $all, UNIVERSES, BG_THEMES, setState, clamp, makePixels, deepCloneFrames,
  N, Z, frames, fi, palette, selColorIx, pattern, PAT_N, cc, currentUniverse, actions
} from './modulab-core.js';

import {
  mountCanvases, resizeCanvas, draw,
  initTools, setTool, selectionAPI,
  transforms, exportNESStrict,
  doUndo, doRedo, pushHistory
} from './modulab-canvas.js';

import { exportPNG, exportJSON, exportSpritesheet, exportSprite16JSON, exportSpriteAtlas, importMCUSprite16, importFromFile, legobox } from './modulab-io.js';

/* ---------- helpers ---------- */
const byId = (id)=> document.getElementById(id);

/* ---------- Action colors (timeline) ---------- */
const ACTION_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
function actionColor(i){ return ACTION_COLORS[i % ACTION_COLORS.length]; }

function addAction(id, startFrame, endFrame, fps){
  if(!id) return;
  const filtered = actions.filter(a => a.id !== id);
  setState({ actions: [...filtered, { id, startFrame, endFrame: Math.min(endFrame, frames.length-1), fps }] });
  renderActionsUI();
}
function removeAction(id){
  setState({ actions: actions.filter(a => a.id !== id) });
  renderActionsUI();
}
function renderActionsUI(){
  const list = byId('actionsList'); if(!list) return;
  list.innerHTML = '';
  actions.forEach((a, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;background:#141925;border:1px solid var(--line);border-radius:6px';
    const sw = document.createElement('span');
    sw.style.cssText = `width:10px;height:10px;border-radius:50%;background:${actionColor(i)};flex-shrink:0`;
    row.appendChild(sw);
    const lbl = document.createElement('span');
    lbl.style.cssText = 'flex:1;font-size:12px;font-family:monospace';
    lbl.textContent = `${a.id}  f${a.startFrame}–${a.endFrame}  ${a.fps}fps`;
    row.appendChild(lbl);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.style.cssText = 'padding:1px 5px;font-size:11px;border-radius:5px;border:1px solid #3a2026;background:#28161a;color:#ff9aa9;cursor:pointer';
    del.onclick = () => removeAction(a.id);
    row.appendChild(del);
    list.appendChild(row);
  });
  renderFramesList();
}



/* ---------- Theme ---------- */
function applyBgTheme(mode){
  const t = BG_THEMES[mode==='light'?'light':'dark'];
  const r = document.documentElement.style;
  r.setProperty('--checker-a', t.checkerA);
  r.setProperty('--checker-b', t.checkerB);
  document.body && (document.body.style.background=t.pageBg);
  setState({ bgTheme: mode==='light'?'light':'dark' });
}

/* ---------- Palette UI ---------- */
function renderPaletteUI(){
  const host = byId('palette'); if(!host) return;
  host.innerHTML = '';

  palette.forEach((hex, ix)=>{
    const sw=document.createElement('div');
    sw.className='sw'+(ix===selColorIx?' sel':'');
    sw.style.background=hex;
    sw.title=`${ix}: ${hex}`;
    sw.onclick=()=>{ setState({ selColorIx:ix }); renderPaletteUI(); draw(); drawPatternCanvas(); };
    const b=document.createElement('span'); b.className='idx'; b.textContent=ix; sw.appendChild(b);
    host.appendChild(sw);
  });

  const stencilSel = byId('stencilColor');
  const pattAltSel = byId('patternAltColor');
  const dAltSel    = byId('ditherAltColor');
  [stencilSel, pattAltSel, dAltSel].forEach(sel=>{
    if(!sel) return;
    const keep = parseInt(sel.value,10);
    sel.innerHTML='';
    palette.forEach((_,i)=>{
      const o=document.createElement('option'); o.value=i; o.textContent=i;
      sel.appendChild(o);
    });
    if(Number.isFinite(keep)&&keep>=0&&keep<palette.length) sel.value=String(keep);
  });
}
function wirePaletteControls(){
  byId('addColor')?.addEventListener('click', ()=>{
    const hex = byId('colorPicker')?.value || '#ffffff';
    setState({ palette: palette.concat(hex) }); renderPaletteUI(); drawPatternCanvas(); draw();
  });
  byId('loadNES')?.addEventListener('click', ()=>{
    setState({ palette: UNIVERSES.NKOTC.palette(), selColorIx:1 }); renderPaletteUI(); drawPatternCanvas(); draw();
  });
  byId('loadLucasLeChuck')?.addEventListener('click', ()=>{
    setState({ palette: UNIVERSES.CB.palette(), selColorIx:1 }); renderPaletteUI(); drawPatternCanvas(); draw();
  });
}

/* ---------- Pattern 8×8 ---------- */
function drawPatternCanvas(){
  const cv=byId('pattern'); if(!cv) return;
  const n=PAT_N, cell=Math.floor(cv.width/n);
  const cx=cv.getContext('2d',{willReadFrequently:true});
  cx.clearRect(0,0,cv.width,cv.height);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++){
    cx.fillStyle = pattern[y][x] ? '#99e2ff' : '#0b0e13';
    cx.fillRect(x*cell,y*cell,cell,cell);
    cx.strokeStyle='#2a3242'; cx.strokeRect(x*cell+.5,y*cell+.5,cell-1,cell-1);
  }
}
function wirePatternEditor(){
  const cv=byId('pattern'); if(!cv) return;
  const n=PAT_N, cell=Math.floor(cv.width/n);
  cv.addEventListener('click',(e)=>{
    const r=cv.getBoundingClientRect();
    const x=Math.floor((e.clientX-r.left)/cell), y=Math.floor((e.clientY-r.top)/cell);
    if(x>=0&&y>=0&&x<n&&y<n){ pattern[y][x]=pattern[y][x]?0:1; drawPatternCanvas(); }
  });
  byId('patternClear')?.addEventListener('click', ()=>{
    for(let y=0;y<n;y++) for(let x=0;x<n;x++) pattern[y][x]=0;
    drawPatternCanvas();
  });
  const use=byId('patternUse'), box=byId('patternBox');
  if(use && box){
    const sync=()=> box.style.display = use.checked ? 'block' : 'none';
    use.addEventListener('change', sync); sync();
  }
}

/* ---------- Dither / Stencil ---------- */
function wireDitherStencil(){
  byId('ditherEnable')?.addEventListener('change', e=> setState({ ditherOn: !!e.target.checked }));
  byId('ditherAltColor')?.addEventListener('change', e=> setState({ ditherAltIx: parseInt(e.target.value,10)||0 }));
  byId('stencilEnable')?.addEventListener('change', e=> setState({ stencilOn: !!e.target.checked }));
  byId('stencilColor') ?.addEventListener('change', e=> setState({ stencilProtectedIx: parseInt(e.target.value,10)||0 }));
  byId('patternAltColor')?.addEventListener('change', e=> setState({ patternAltIx: parseInt(e.target.value,10)||0 }));
}

// no wireTools() OU onde já liga os controles da direita:
const $v = id => document.getElementById(id);

function startCycling(){
  const s = parseInt($v('ccStart').value,10)||1;
  const e = parseInt($v('ccEnd').value,10)||4;
  const ms = parseInt($v('ccMs').value,10)||200;

  // bounds para não estourar a paleta
  const a = Math.max(0, Math.min(palette.length-1, s));
  const b = Math.max(0, Math.min(palette.length-1, e));
  if (b <= a) return alert('Faixa inválida (End deve ser > Start).');

  stopCycling();
  setState({ cc:{ ...cc, running:true, start:a, end:b, ms, pair:null } });

  cc.timer = setInterval(()=>{
    const tmp = palette[b];
    for (let i=b; i>a; i--) palette[i] = palette[i-1];
    palette[a] = tmp;
    renderPaletteUI?.(); 
    draw();
  }, ms);
}

function stopCycling(){
  if (cc?.timer) clearInterval(cc.timer);
  setState({ cc: { ...cc, running:false, timer:null, pair:null } });
  // repinta pra garantir estado estável
  renderPaletteUI?.();
  draw?.();
}

function startPair(){
  const pairRaw = ($v('ccPair').value||'').split(',');
  const a = Math.max(0, Math.min(palette.length-1, parseInt(pairRaw[0],10)));
  const b = Math.max(0, Math.min(palette.length-1, parseInt(pairRaw[1],10)));
  if (!Number.isFinite(a)||!Number.isFinite(b)) return alert('Par inválido. Ex: 3,14');

  stopCycling();
  const ms = parseInt($v('ccMs').value,10)||200;
  setState({ cc:{ ...cc, running:true, pair:[a,b], ms } });

  cc.timer = setInterval(()=>{
    const tmp = palette[a]; palette[a] = palette[b]; palette[b] = tmp;
    renderPaletteUI?.(); 
    draw();
  }, ms);
}

function applyUniverse(uId){
  if (!UNIVERSES[uId]) return;
  // -- para color cycling sem depender de stopCycling:
  if (cc?.timer) { clearInterval(cc.timer); }
  setState({ cc: { ...cc, running:false, timer:null, pair:null } });

  // aplica paleta e tamanho default do universo
  const uni = UNIVERSES[uId];
  setState({
    currentUniverse: uId,
    palette: uni.palette(),
    N: uni.defaultSize || N,
    fi: 0,
    frames: [ makePixels(uni.defaultSize || N) ]
  });

  // preenche o box do Git por padrão (editável)
  const ghBox = document.getElementById('ghBox');
  if (ghBox && !ghBox.value) ghBox.value = uId;

  // UI
  const s16btn = document.getElementById('exportSprite16'); if(s16btn) s16btn.style.display = uId==='MCU' ? '' : 'none';
  const ap = document.getElementById('actionsPanel'); if(ap) ap.style.display = uId==='MCU' ? '' : 'none';
  document.getElementById('size').value = String(N);
  renderPaletteUI(); drawPatternCanvas(); resizeCanvas(); draw();
}

function wireUniverseSelect(){
  const uniSel = document.getElementById('universe');
  if (!uniSel) return;
  // valor inicial da UI = universo atual do core
  uniSel.value = currentUniverse;
  uniSel.onchange = () => applyUniverse(uniSel.value);
}

/* ---------- Tools + Hotkeys ---------- */
function wireTools(){
  $all('.tools button').forEach(b=> b.onclick = ()=> setTool(b.dataset.tool));
  window.addEventListener('keydown', (e)=>{
    const k=e.key;
    if('bBeEfFlLoOpPiImM'.includes(k)) {
      const map={b:'brush',e:'eraser',f:'fill',l:'line',r:'rect',o:'oval',p:'poly',i:'eyedrop',m:'select'};
      setTool(map[k.toLowerCase()]);
    }
    if(k==='['){ const bs=byId('brushSize'); if(bs){ bs.value = String(Math.max(1,(parseInt(bs.value,10)||1)-1)); bs.dispatchEvent(new Event('input')); } }
    if(k===']'){ const bs=byId('brushSize'); if(bs){ bs.value = String(Math.min(8,(parseInt(bs.value,10)||1)+1)); bs.dispatchEvent(new Event('input')); } }
    const mod=e.metaKey||e.ctrlKey;
    if(mod && k.toLowerCase()==='z' && !e.shiftKey){ e.preventDefault(); doUndo?.(); }
    if((mod && k.toLowerCase()==='z' && e.shiftKey) || (mod && k.toLowerCase()==='y')){ e.preventDefault(); doRedo?.(); }
    if(k==='g'||k==='G'){ const chk=byId('toggleGrid'); if(chk){ chk.checked=!chk.checked; chk.dispatchEvent(new Event('change')); } }
  });
}

/* ---------- Topbar ---------- */
function wireTopbar(){
  const sizeSel = $('#size');
  if (sizeSel) {
    sizeSel.onchange = () => {
      const n = parseInt(sizeSel.value, 10) || 16;
      setState({ N: n });
      frames.splice(0, frames.length, makePixels(n));
      setState({ fi: 0 });
      // resizeCanvas() só funciona após mountCanvases(); com a nova ordem, ok.
      resizeCanvas(); 
      draw();
    };
    // NÃO despache aqui se ainda não montou canvas; com a nova ordem o canvas já existe.
    sizeSel.dispatchEvent(new Event('change'));
  }

  // zoom via scroll: usa clamp do core
  const wrap = byId('canvasWrap');
  if (wrap) {
    wrap.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const cur = parseInt(byId('zoom').value,10) || 16;
      const nz = clamp(cur + (e.deltaY<0?+1:-1), 4, 48);
      byId('zoom').value = String(nz);
      setState({ Z:nz });
      resizeCanvas();
      draw();
    }, {passive:false});
  }
  byId('toggleGrid') ?.addEventListener('change', e=>{ setState({ showGrid: !!e.target.checked }); draw(); });
  byId('toggleOnion')?.addEventListener('change', e=>{ setState({ showOnion:!!e.target.checked }); draw(); });
  byId('toggleWrap') ?.addEventListener('change', e=>{ setState({ wrapPreview:!!e.target.checked }); resizeCanvas(); draw(); });

  byId('bgTheme')?.addEventListener('change', e=> applyBgTheme(e.target.value));

  byId('exportPNG') ?.addEventListener('click', exportPNG);
  byId('exportJSON')?.addEventListener('click', exportJSON);
  byId('exportSprite16')?.addEventListener('click', exportSprite16JSON);
  byId('importJSON')?.addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    e.target.value = ''; // reset para permitir re-import do mesmo arquivo
    try {
      const text = await f.text();
      const json = JSON.parse(text);

      // ── MCU sprite16 ──
      if(json.type === 'sprite16'){
        const { frame, palette: mcu8, W, H } = importMCUSprite16(json);
        pushHistory();
        setState({ N:W, palette:mcu8, fi:0 });
        frames.splice(0, frames.length, frame);
        resizeCanvas(); draw(); renderFramesList(); renderPaletteUI();
        return;
      }

      // ── Projeto ModuLab (formato existente) ──
      if(json.frames && Array.isArray(json.frames)){
        pushHistory();
        setState({ N: json.size||N, palette: json.palette||palette, fi:0 });
        frames.splice(0, frames.length, ...deepCloneFrames(json.frames));
        resizeCanvas(); draw(); renderFramesList(); renderPaletteUI();
        return;
      }

      alert('Formato não reconhecido. Esperado: sprite16 MCU ou project ModuLab.');
    } catch(err){
      console.error('[importJSON]', err);
      alert(err?.message || 'Falha no import.');
    }
  });

  // opcional: spritesheet rápido
  byId('exportSheet')?.addEventListener('click', ()=> exportSpritesheet({layout:'row'}));
}

/* ---------- Add-ons ---------- */
function wireAddOns(){
  byId('nx_mirrorH')?.addEventListener('click', ()=>{ transforms?.mirrorH?.(); });
  byId('nx_mirrorV')?.addEventListener('click', ()=>{ transforms?.mirrorV?.(); });
  byId('nx_rot90')  ?.addEventListener('click', ()=>{ transforms?.rot90?.();  });
  byId('nx_rot180') ?.addEventListener('click', ()=>{ transforms?.rot180?.(); });
  byId('nx_rot270') ?.addEventListener('click', ()=>{ transforms?.rot270?.(); });
  byId('nx_exportNES')?.addEventListener('click', ()=>{
    const dir = byId('nx_dirName')?.value?.trim() || 'front_walk';
    exportNESStrict?.(dir);
  });
}

/* ---------- Timeline: thumbs + rAF playback ---------- */
let rafId=null, lastTime=0, acc=0;

function renderFramesList(){
  const ul = byId('frames'); if(!ul) return;
  ul.innerHTML = '';

  frames.forEach((f, i)=>{
    const li=document.createElement('li');
    // thumb canvas
    const thumb=document.createElement('canvas');
    const size=64, scale=Math.max(1, Math.floor(size/Math.max(1,N)));
    thumb.width=N*scale; thumb.height=N*scale;
    const tx=thumb.getContext('2d',{willReadFrequently:true});
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const ix=f[y][x]; if(ix>=0){ tx.fillStyle=palette[ix]; tx.fillRect(x*scale,y*scale,scale,scale); }
    }
    li.appendChild(thumb);

    const badge=document.createElement('span'); badge.className='badge'; badge.textContent = (i===fi?'●':'');
    li.appendChild(badge);

    // action badge: colored strip at bottom of thumb
    const actionIdx = actions.findIndex(a => i >= a.startFrame && i <= a.endFrame);
    if(actionIdx >= 0){
      const strip = document.createElement('div');
      strip.style.cssText = `height:3px;border-radius:2px;background:${actionColor(actionIdx)};width:90%;margin:2px auto 0`;
      strip.title = actions[actionIdx].id;
      li.appendChild(strip);
    }

    li.onclick=()=>{ setState({ fi:i }); draw(); renderFramesList(); };
    ul.appendChild(li);
  });
}

function tick(ts){
  if (!rafId){ lastTime=0; acc=0; return; }
  if (!lastTime) lastTime = ts;
  const fps = Math.max(1, Math.min(60, parseInt(byId('fps')?.value,10)||6));
  const step = 1000/fps;
  acc += (ts - lastTime);
  lastTime = ts;
  while (acc >= step){
    setState({ fi:(fi+1)%frames.length });
    acc -= step;
  }
  draw();
  renderFramesList();
  rafId = requestAnimationFrame(tick);
}
function startPlayback(){ if(!rafId){ rafId=requestAnimationFrame(tick); } }
function stopPlayback(){ if(rafId){ cancelAnimationFrame(rafId); rafId=null; } }

function wireTimeline(){
  byId('frameAdd') ?.addEventListener('click', ()=>{
    const f = frames[fi].map(r=>r.slice()); frames.splice(fi+1,0,f);
    setState({ fi: fi+1 }); draw(); renderFramesList();
  });
  byId('frameDup') ?.addEventListener('click', ()=>{
    const f = frames[fi].map(r=>r.slice()); frames.splice(fi+1,0,f); renderFramesList();
  });
  byId('frameDel') ?.addEventListener('click', ()=>{
    if(frames.length<=1) return;
    frames.splice(fi,1); setState({ fi:Math.max(0,fi-1) }); draw(); renderFramesList();
  });
  byId('frameUp')  ?.addEventListener('click', ()=>{
    if(fi<=0) return; [frames[fi-1],frames[fi]]=[frames[fi],frames[fi-1]]; setState({fi:fi-1}); draw(); renderFramesList();
  });
  byId('frameDown')?.addEventListener('click', ()=>{
    if(fi>=frames.length-1) return; [frames[fi+1],frames[fi]]=[frames[fi],frames[fi+1]]; setState({fi:fi+1}); draw(); renderFramesList();
  });

  byId('play') ?.addEventListener('click', startPlayback);
  byId('pause')?.addEventListener('click', stopPlayback);

  byId('btnUndo')?.addEventListener('click', ()=> doUndo?.());
  byId('btnRedo')?.addEventListener('click', ()=> doRedo?.());

  renderFramesList();

  // ── Actions UI ──
  byId('actionAdd')?.addEventListener('click', ()=>{
    const id    = (byId('actionId')?.value||'').trim(); if(!id) return;
    const start = parseInt(byId('actionStart')?.value,10)||0;
    const end   = parseInt(byId('actionEnd')?.value,10)||0;
    const fps   = parseInt(byId('actionFps')?.value,10)||8;
    addAction(id, Math.min(start,end), Math.max(start,end), fps);
  });
  byId('exportAtlas')?.addEventListener('click', ()=>{
    const name = (byId('spriteName')?.value||'sprite').trim();
    exportSpriteAtlas({ name, actions, frames, N, palette });
  });
  renderActionsUI();
}

/* ---------- LegoBox Bridge ---------- */
function wireGitBridge(){
  byId('lbConnect')?.addEventListener('click', async ()=>{
    const url   = (byId('lbUrl')  ?.value || '').trim();
    const token = (byId('lbToken')?.value || '').trim();
    if(!url || !token) return alert('Preencha a URL e o token.');
    legobox.connect({ url, token });
    alert('LegoBox conectado ✅');
    await refreshProjectsFromGit();
    await refreshPiecesFromGit();
  });

  byId('saveProject')?.addEventListener('click', async ()=>{
    if(!legobox.isConnected()) return alert('Conecte o LegoBox primeiro.');
    const name = (byId('projectName')?.value || 'untitled').trim();
    if(!name) return alert('Nome do projeto vazio.');
    try{
      await legobox.saveJSON('projects', name, { N, palette, frames });
      alert(`Projeto "${name}" salvo.`);
      await refreshProjectsFromGit();
    }catch(err){ console.error(err); alert('Falha ao salvar projeto.'); }
  });

  byId('loadProject')?.addEventListener('click', async ()=>{
    if(!legobox.isConnected()) return alert('Conecte o LegoBox primeiro.');
    const name = (byId('projectSelect')?.value || '').trim();
    if(!name) return alert('Selecione um projeto.');
    try{
      const data = await legobox.loadJSON('projects', name);
      frames.splice(0, frames.length, ...(data.frames || [makePixels(N)]));
      setState({ N: data.N || data.size || N, fi: 0, palette: data.palette?.length ? data.palette : palette });
      resizeCanvas(); draw(); renderPaletteUI();
      alert(`Projeto "${name}" carregado.`);
    }catch(err){ console.error(err); alert('Falha ao carregar projeto.'); }
  });

  byId('savePiece')?.addEventListener('click', async ()=>{
    if(!legobox.isConnected()) return alert('Conecte o LegoBox primeiro.');
    const name = prompt('Nome da peça?', 'piece')?.trim(); if(!name) return;
    const hasSel = selectionAPI?.hasSelection?.() || false;
    const rect   = hasSel ? selectionAPI.getRect() : { x:0, y:0, w:N, h:N };
    const pixels = hasSel ? selectionAPI.pick()    : frames[fi].map(r=>r.slice());
    try{
      await legobox.saveJSON('pieces', name, { w:rect.w, h:rect.h, pixels, paletteSnapshot: palette.slice(), universe: currentUniverse });
      alert(`Peça "${name}" salva.`);
      await refreshPiecesFromGit();
    }catch(err){ console.error(err); alert('Falha ao salvar peça.'); }
  });

  byId('saveAnim')?.addEventListener('click', async ()=>{
    if(!legobox.isConnected()) return alert('Conecte o LegoBox primeiro.');
    const name = prompt('Nome da animação?', 'anim')?.trim(); if(!name) return;
    try{
      await legobox.saveJSON('sprites', name, { size:N, palette, frames });
      alert('Animação salva.');
    }catch(err){ console.error(err); alert('Falha ao salvar animação.'); }
  });
}

async function refreshProjectsFromGit(){
  const sel = byId('projectSelect'); if(!sel || !legobox.isConnected()) return;
  try{
    const list = await legobox.list('projects');
    sel.innerHTML = '';
    list.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
  }catch(err){ console.error('refreshProjects:', err); }
}

async function refreshPiecesFromGit(){
  const rail=byId('trayRail'), catSel=byId('trayCat');
  if(!rail || !catSel || !legobox.isConnected()) return;
  rail.innerHTML = '<span style="color:var(--muted);font-size:12px">Carregando peças…</span>';

  try{
    const names = await legobox.list('pieces');
    const all = await Promise.all(
      names.map(async n => {
        const d = await legobox.loadJSON('pieces', n);
        return { name:n, data:d, universe: d.universe||'' };
      })
    );

    const setUnis = Array.from(new Set(all.map(it=>it.universe).filter(Boolean))).sort();
    const prev = catSel.value || currentUniverse;
    catSel.innerHTML = '<option value="__all__">Todos</option>' + setUnis.map(u=>`<option value="${u}">${UNIVERSES[u]?.name || u}</option>`).join('');
    catSel.value = setUnis.includes(prev) ? prev : (setUnis.includes(currentUniverse) ? currentUniverse : '__all__');

    const active   = catSel.value;
    const filtered = all.filter(it=> active==='__all__' ? true : it.universe===active);
    rail.innerHTML  = '';

    if(!filtered.length){
      const empty=document.createElement('div'); empty.className='hint'; empty.textContent='(sem peças nesta categoria)';
      rail.appendChild(empty); return;
    }

    for(const meta of filtered){
      const item=document.createElement('div'); item.className='tray-item';
      const thumb=document.createElement('div'); thumb.className='thumb';
      const can=document.createElement('canvas');
      const scale=Math.max(2, Math.floor(120/Math.max(meta.data.w, meta.data.h)));
      can.width=meta.data.w*scale; can.height=meta.data.h*scale;
      const cx=can.getContext('2d',{willReadFrequently:true});
      for(let y=0;y<meta.data.h;y++) for(let x=0;x<meta.data.w;x++){
        const ix=meta.data.pixels[y][x]; if(ix>=0){ cx.fillStyle=(meta.data.paletteSnapshot||palette)[ix]; cx.fillRect(x*scale,y*scale,scale,scale); }
      }
      thumb.appendChild(can); item.appendChild(thumb);
      const label=document.createElement('div'); label.className='meta';
      label.textContent=`${meta.name} — ${meta.data.w}×${meta.data.h}${meta.universe?' · '+meta.universe:''}`;
      item.appendChild(label);

      const btns=document.createElement('div'); btns.className='piece-btns';
      const loadBtn=document.createElement('button'); loadBtn.className='load'; loadBtn.textContent='Load';
      loadBtn.onclick=(ev)=>{ ev.stopPropagation(); selectionAPI.setStamp({ w:meta.data.w, h:meta.data.h, pixels:meta.data.pixels }); };
      const delBtn=document.createElement('button'); delBtn.className='delete'; delBtn.textContent='Del';
      delBtn.onclick=async (ev)=>{
        ev.stopPropagation();
        if(!confirm(`Apagar "${meta.name}"?`)) return;
        try{ await legobox.deleteJSON('pieces', meta.name); await refreshPiecesFromGit(); }
        catch(err){ alert('Falha ao apagar peça.'); }
      };
      btns.appendChild(loadBtn); btns.appendChild(delBtn);
      item.appendChild(btns);

      item.onclick=()=> selectionAPI.setStamp({ w:meta.data.w, h:meta.data.h, pixels:meta.data.pixels });
      rail.appendChild(item);
    }
    catSel.onchange = ()=> refreshPiecesFromGit();
  }catch(err){
    console.error('refreshPieces:', err);
    rail.innerHTML = '<span style="color:var(--muted);font-size:12px">Erro ao carregar peças.</span>';
  }
}

/* ---------- Color Cycling ---------- */
function wireColorCycling(){
  byId('ccStartBtn')?.addEventListener('click', startCycling);
  byId('ccStopBtn') ?.addEventListener('click', stopCycling);
  byId('ccPairStartBtn')?.addEventListener('click', startPair);
  byId('ccPairStopBtn') ?.addEventListener('click', stopCycling);
  window.addEventListener('beforeunload', stopCycling);
}

/* ---------- Boot ---------- */
(function main(){
  applyBgTheme('dark');
  mountCanvases(); initTools();
  wireUniverseSelect();
  wireTopbar();
  wireTools();
  wireAddOns?.();
  wireDitherStencil();
  wirePaletteControls();
  wirePatternEditor();
  wireTimeline?.();
  wireGitBridge();
  wireColorCycling();   
  renderPaletteUI();
  drawPatternCanvas?.();
  resizeCanvas();
  draw();
})();
