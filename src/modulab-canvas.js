/* =====================================================
   modulab-canvas.js — Canvas, draw, tools, seleção
   + rAF playback hook + transforms + export NES stub
   ===================================================== */

import {
  $, clamp, hexToRgba, makePixels, deepCloneFrames, UNIVERSES, PAT_N, DITHER,
  setState, N, Z, frames, fi, palette, selColorIx, brushSize,
  showGrid, wrapPreview, showOnion,
  stencilOn, stencilProtectedIx,
  pattern, patternAltIx, ditherOn, ditherAltIx, ditherMode,
  lastIssues, undoStack, redoStack, MAX_HISTORY, actions, setState
} from './modulab-core.js';

let c, ctx, ov, ovx;

export function mountCanvases(){
  c = $('#c'); ctx = c.getContext('2d', { willReadFrequently:true });
  ov = $('#overlay'); ovx = ov.getContext('2d');
}
export function resizeCanvas(){
  if (!c || !ov) return; // <- guarda
  const mul = wrapPreview ? 3 : 1;
  c.width = N*Z*mul; 
  c.height = N*Z*mul;
  ov.width = c.width; 
  ov.height = c.height;
  draw();
}

/* ---------- render ---------- */
function renderTile(tctx, px){
  for (let y=0;y<N;y++) for (let x=0;x<N;x++){
    const ix = px[y][x];
    if (ix>=0){ tctx.fillStyle = palette[ix]; tctx.fillRect(x*Z,y*Z,Z,Z); }
  }
}
function drawTint(img, x, y, tint='rgba(255,0,255,0.35)'){
  ctx.save(); ctx.drawImage(img, x, y);
  ctx.globalCompositeOperation='source-atop';
  ctx.fillStyle=tint; ctx.fillRect(x,y,img.width,img.height);
  ctx.restore();
}
function drawIssuesOverlay(){
  ovx.clearRect(0,0,ov.width,ov.height);
  if (!lastIssues.length) return;
  const offX = wrapPreview ? N*Z : 0;
  const offY = wrapPreview ? N*Z : 0;
  ovx.save();
  ovx.fillStyle='rgba(255,64,64,0.18)';
  ovx.strokeStyle='rgba(255,64,64,0.9)';
  ovx.lineWidth=2;
  for (const it of lastIssues){
    const T = it.tileN || 8;
    const x0 = offX + it.tx*T*Z, y0 = offY + it.ty*T*Z;
    const w  = Math.min(T, N-it.tx*T)*Z, h = Math.min(T, N-it.ty*T)*Z;
    ovx.fillRect(x0,y0,w,h);
    ovx.strokeRect(x0+1,y0+1,w-2,h-2);
  }
  ovx.restore();
}
function drawGrids(tile){
  if (!showGrid) return;
  const tileW=tile.width, tileH=tile.height;
  const OX=wrapPreview?tileW:0, OY=wrapPreview?tileH:0;
  ctx.save();
  ctx.beginPath(); ctx.rect(OX,OY,tileW,tileH); ctx.clip();

  ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
  for(let i=1;i<N;i++){
    const p=i*Z+.5;
    ctx.beginPath(); ctx.moveTo(OX+p, OY); ctx.lineTo(OX+p, OY+tileH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(OX, OY+p); ctx.lineTo(OX+tileW, OY+p); ctx.stroke();
  }
  ctx.strokeStyle='#2d3342'; ctx.lineWidth=1.5;
  ctx.strokeRect(OX+.75, OY+.75, tileW-1.5, tileH-1.5);

  const stepAttr = UNIVERSES.NKOTC.tile===8 ? Z*16 : Z*32;
  ctx.strokeStyle='rgba(97,218,251,0.22)'; ctx.lineWidth=1.5;
  for (let px=stepAttr; px<tileW; px+=stepAttr){
    ctx.beginPath(); ctx.moveTo(OX+px+.5, OY); ctx.lineTo(OX+px+.5, OY+tileH); ctx.stroke();
  }
  for (let py=stepAttr; py<tileH; py+=stepAttr){
    ctx.beginPath(); ctx.moveTo(OX, OY+py+.5); ctx.lineTo(OX+tileW, OY+py+.5); ctx.stroke();
  }
  ctx.restore();
}

export function draw(){
  const px = frames[fi];
  const tile = document.createElement('canvas');
  tile.width=N*Z; tile.height=N*Z;
  renderTile(tile.getContext('2d',{willReadFrequently:true}), px);

  const OX=wrapPreview?tile.width:0, OY=wrapPreview?tile.height:0;
  ctx.clearRect(0,0,c.width,c.height);

  // onion (prev/next) — pronto para expandir a multi
  if (showOnion && frames.length>1){
    const prev=document.createElement('canvas'); prev.width=tile.width; prev.height=tile.height;
    renderTile(prev.getContext('2d',{willReadFrequently:true}), frames[(fi-1+frames.length)%frames.length]);
    const next=document.createElement('canvas'); next.width=tile.width; next.height=tile.height;
    renderTile(next.getContext('2d',{willReadFrequently:true}), frames[(fi+1)%frames.length]);
    drawTint(prev, OX, OY, 'rgba(255,0,255,0.35)');
    drawTint(next, OX, OY, 'rgba(0,255,255,0.35)');
  }

  if (!wrapPreview) ctx.drawImage(tile,0,0);
  else{
    ctx.drawImage(tile, OX, OY);
    ctx.drawImage(tile, OX - tile.width, OY);
    ctx.drawImage(tile, OX + tile.width, OY);
    ctx.drawImage(tile, OX, OY - tile.height);
    ctx.drawImage(tile, OX, OY + tile.height);
    ctx.drawImage(tile, OX - tile.width, OY - tile.height);
    ctx.drawImage(tile, OX + tile.width, OY - tile.height);
    ctx.drawImage(tile, OX - tile.width, OY + tile.height);
    ctx.drawImage(tile, OX + tile.width, OY + tile.height);
  }
  drawGrids(tile);
  drawIssuesOverlay();
}

/* ---------- Tools / seleção / input ---------- */
let tool='brush', isDown=false, mouseBtn=0, dragStart=null;
let selectTool=false, selActive=false, selA=null, selB=null, selRect=null, stamping=null;

export function setTool(name){
  tool=name; selectTool=(name==='select');
  document.querySelectorAll('.tools button').forEach(b=>b.classList.toggle('active', b.dataset.tool===name));
  if (!selectTool) clearSelection();
}

export function initTools(){
  const bs = document.getElementById('brushSize');
  if (bs) bs.oninput = ()=> setState({ brushSize: parseInt(bs.value,10)||1 });

  c.addEventListener('contextmenu', e=>e.preventDefault());

  c.addEventListener('mousedown', e=>{
    isDown=true; mouseBtn=e.button;
    const cell=pxToCell(e.clientX,e.clientY); if(!cell) return;

    if (stamping){
      putRectPixels({x:cell.x,y:cell.y,w:stamping.piece.w,h:stamping.piece.h}, stamping.piece.pixels);
      stamping=null; ovx.clearRect(0,0,ov.width,ov.height); return;
    }

    if (selectTool){ selA=cell; selB=cell; selActive=false; return; }

    pushHistory();
    if (tool==='eyedrop'){
      const ix=frames[fi][cell.y][cell.x];
      if (ix>=0) setState({ selColorIx: ix });
      return;
    }

    dragStart=cell;
    if (tool==='brush')  drawBrush(cell.x,cell.y);
    else if (tool==='eraser') eraseBrush(cell.x,cell.y);
    else if (tool==='fill')   doFill(cell.x,cell.y);

    draw();
  });

  window.addEventListener('mouseup', e=>{
    if(!isDown && !stamping) return;
    const end=pxToCell(e.clientX,e.clientY);

    if(isDown && dragStart && end){
      if(tool==='line') linePixels(dragStart.x,dragStart.y,end.x,end.y,(x,y)=>setPixel(x,y,selColorIx));
      if(tool==='rect') rectPixels(dragStart.x,dragStart.y,end.x,end.y,(x,y)=>setPixel(x,y,selColorIx), !document.getElementById('outlineOnly')?.checked);
      if(tool==='oval') ellipsePixels(dragStart.x,dragStart.y,end.x,end.y,(x,y)=>setPixel(x,y,selColorIx), !document.getElementById('outlineOnly')?.checked);
    }
    if (selectTool && selA && selB){ selRect=normRect(selA,selB); selActive = selRect.w>0 && selRect.h>0; }

    isDown=false; ovx.clearRect(0,0,ov.width,ov.height); dragStart=null; draw();
  });

  c.addEventListener('mousemove', e=>{
    if (!isDown && !stamping && tool!=='poly') return;

    // stamping preview
    if (stamping){
      const cell=pxToCell(e.clientX,e.clientY); ovx.clearRect(0,0,ov.width,ov.height);
      if (cell){
        stamping.x=cell.x; stamping.y=cell.y;
        const { piece }=stamping; ovx.globalAlpha=0.9;
        for(let y=0;y<piece.h;y++) for(let x=0;x<piece.w;x++){
          const ix=piece.pixels[y][x]; if(ix>=0){
            const p=cellToPxOverlay(cell.x+x,cell.y+y);
            ovx.fillStyle=palette[ix]; ovx.fillRect(p.x,p.y,Z,Z);
          }
        }
        drawSelection(selActive ? selRect : { x:cell.x, y:cell.y, w:piece.w, h:piece.h });
      }
      return;
    }

    // retângulo de seleção em arrasto
    if (selectTool && isDown){
      const cell=pxToCell(e.clientX,e.clientY);
      if (!cell) return;
      selB = cell;
      ovx.clearRect(0,0,ov.width,ov.height);
      drawSelection(normRect(selA, selB));
      return;
    }

    const cell=pxToCell(e.clientX,e.clientY);
    if (!cell) return;

    if (tool==='brush'){  drawBrush(cell.x,cell.y); draw(); return; }
    if (tool==='eraser'){ eraseBrush(cell.x,cell.y); draw(); return; }

    if (!dragStart) return;
    ovx.clearRect(0,0,ov.width,ov.height);

    if (tool==='line'){
      linePixels(dragStart.x,dragStart.y,cell.x,cell.y,(x,y)=>{
        const p=cellToPxOverlay(x,y); ovx.fillStyle=palette[selColorIx]; ovx.fillRect(p.x,p.y,Z,Z);
      });
      return;
    }
    if (tool==='rect'){
      const fill = !document.getElementById('outlineOnly')?.checked;
      const put  = (x,y)=>{ const p=cellToPxOverlay(x,y); ovx.fillStyle=palette[selColorIx]; ovx.fillRect(p.x,p.y,Z,Z); };
      rectPixels(dragStart.x,dragStart.y,cell.x,cell.y,put,fill); return;
    }
    if (tool==='oval'){
      const fill = !document.getElementById('outlineOnly')?.checked;
      const put  = (x,y)=>{ const p=cellToPxOverlay(x,y); ovx.fillStyle=palette[selColorIx]; ovx.fillRect(p.x,p.y,Z,Z); };
      ellipsePixels(dragStart.x,dragStart.y,cell.x,cell.y,put,fill); return;
    }
  });
}

/* ---------- helpers raster ---------- */
function pxToCell(mx,my){
  const r=c.getBoundingClientRect(), sx=c.width/r.width, sy=c.height/r.height;
  const offX=wrapPreview?N*Z:0, offY=wrapPreview?N*Z:0;
  const cx=(mx-r.left)*sx, cy=(my-r.top)*sy;
  const x=Math.floor((cx-offX)/Z), y=Math.floor((cy-offY)/Z);
  if (x<0||y<0||x>=N||y>=N) return null;
  return {x,y};
}
function cellToPxOverlay(x,y){
  const offX=wrapPreview?N*Z:0, offY=wrapPreview?N*Z:0;
  return { x:offX + x*Z, y:offY + y*Z };
}
function setPixel(x,y,v){
  if (x<0||y<0||x>=N||y>=N) return;
  if (stencilOn && frames[fi][y][x]===stencilProtectedIx) return;
  frames[fi][y][x] = v|0;
}

function drawBrush(x,y){
  const r=Math.floor((brushSize|0)/2);
  for(let yy=-r;yy<=r;yy++) for(let xx=-r;xx<=r;xx++){
    if (Math.abs(xx)+Math.abs(yy) <= r){
      const ix = (ditherOn && !document.getElementById('patternUse')?.checked) ? ditherAt(x+xx,y+yy) : selColorIx;
      setPixel(x+xx,y+yy,ix);
    }
  }
}
function eraseBrush(x,y){
  const r=Math.floor((brushSize|0)/2);
  for(let yy=-r;yy<=r;yy++) for(let xx=-r;xx<=r;xx++){
    if(Math.abs(xx)+Math.abs(yy)<=r) setPixel(x+xx,y+yy,-1);
  }
}
function ditherAt(x,y){
  const M=DITHER[ditherMode]||DITHER.CHECK, h=M.length,w=M[0].length, t=M[y%h][x%w], thr=(h*w)/2;
  return (t<thr)? selColorIx : ditherAltIx;
}
function doFill(x,y){
  const contig=(document.querySelector('input[name="fillmode"]:checked')?.value||'contig')==='contig';
  const tgt=frames[fi][y][x];
  if (document.getElementById('patternUse')?.checked) fillWithPattern(x,y,contig,tgt);
  else if (ditherOn) fillWithDither(x,y,contig,tgt);
  else floodFill(x,y,tgt,selColorIx,contig);
}
function floodFill(x,y,targetIx,newIx,contig=true){
  if(targetIx===newIx) return;
  const px=frames[fi], W=N, H=N;
  if(contig){
    const q=[[x,y]], seen=new Set(), key=(a,b)=>a|b<<10;
    while(q.length){
      const [cx,cy]=q.pop(); if(cx<0||cy<0||cx>=W||cy>=H) continue;
      const k=key(cx,cy); if(seen.has(k)) continue; seen.add(k);
      if(px[cy][cx]!==targetIx) continue; setPixel(cx,cy,newIx);
      q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
  } else {
    for(let yy=0;yy<H;yy++) for(let xx=0;xx<W;xx++) if(px[yy][xx]===targetIx) setPixel(xx,yy,newIx);
  }
}
function fillWithPattern(x,y,contig,tgt){
  const px=frames[fi];
  if(contig){
    const q=[[x,y]], seen=new Set(), key=(a,b)=>a|b<<10;
    while(q.length){
      const [cx,cy]=q.pop(); if(cx<0||cy<0||cx>=N||cy>=N) continue;
      const k=key(cx,cy); if(seen.has(k)) continue; seen.add(k);
      if(px[cy][cx]!==tgt) continue;
      const bit=pattern[cy%PAT_N][cx%PAT_N]; setPixel(cx,cy, bit?patternAltIx:selColorIx);
      q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
  } else {
    for(let yy=0;yy<N;yy++) for(let xx=0;xx<N;xx++){
      if(px[yy][xx]===tgt){ const bit=pattern[yy%PAT_N][xx%PAT_N]; setPixel(xx,yy, bit?patternAltIx:selColorIx); }
    }
  }
}
function fillWithDither(x,y,contig,tgt){
  const px=frames[fi], put=(cx,cy)=>{ if(px[cy][cx]===tgt) setPixel(cx,cy, ditherAt(cx,cy)); };
  if(contig){
    const q=[[x,y]], seen=new Set(), key=(a,b)=>a|b<<10;
    while(q.length){
      const [cx,cy]=q.pop(); if(cx<0||cy<0||cx>=N||cy>=N) continue;
      const k=key(cx,cy); if(seen.has(k)) continue; seen.add(k);
      put(cx,cy); if(px[cy][cx]===tgt) q.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
  } else { for(let yy=0;yy<N;yy++) for(let xx=0;xx<N;xx++) put(xx,yy); }
}

/* ---------- raster basics ---------- */
function linePixels(x0,y0,x1,y1,put){ let dx=Math.abs(x1-x0), sx=x0<x1?1:-1, dy=-Math.abs(y1-y0), sy=y0<y1?1:-1, err=dx+dy;
  while(true){ put(x0,y0); if(x0===x1&&y0===y1) break; const e2=2*err; if(e2>=dy){err+=dy;x0+=sx;} if(e2<=dx){err+=dx;y0+=sy;} } }
function rectPixels(x0,y0,x1,y1,put,fill=false){ const [xa,xb]=[Math.min(x0,x1),Math.max(x0,x1)], [ya,yb]=[Math.min(y0,y1),Math.max(y0,y1)];
  if(fill){ for(let y=ya;y<=yb;y++) for(let x=xa;x<=xb;x++) put(x,y); }
  else { for(let x=xa;x<=xb;x++){put(x,ya); put(x,yb);} for(let y=ya;y<=yb;y++){put(xa,y); put(xb,y);} } }
function ellipsePixels(x0,y0,x1,y1,put,fill=false){ const [xa,xb]=[Math.min(x0,x1),Math.max(x0,x1)], [ya,yb]=[Math.min(y0,y1),Math.max(y0,y1)];
  const rx=Math.max(0,Math.floor((xb-xa)/2)), ry=Math.max(0,Math.floor((yb-ya)/2)); const cx=xa+rx, cy=ya+ry;
  if(rx===0||ry===0){ linePixels(xa,ya,xb,yb,put); return; }
  if(fill){ for(let y=ya;y<=yb;y++) for(let x=xa;x<=xb;x++){ const dx=(x-cx)/rx, dy=(y-cy)/ry; if(dx*dx+dy*dy<=1.0) put(x,y);} }
  else { const steps=Math.max(12, Math.round(2*Math.PI*Math.max(rx,ry))); let px=null,py=null;
    for(let i=0;i<=steps;i++){ const t=i/steps*2*Math.PI; const x=Math.round(cx+rx*Math.cos(t)), y=Math.round(cy+ry*Math.sin(t));
      if(px!=null) linePixels(px,py,x,y,put); px=x; py=y; } }
}

/* ---------- seleção ---------- */
function normRect(a,b){
  const x0=Math.max(0,Math.min(a.x,b.x)), y0=Math.max(0,Math.min(a.y,b.y));
  const x1=Math.min(N-1,Math.max(a.x,b.x)), y1=Math.min(N-1,Math.max(a.y,b.y));
  return {x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
}
function pickRectPixels(rect){
  const out=Array.from({length:rect.h},()=>Array(rect.w).fill(-1)), src=frames[fi];
  for(let y=0;y<rect.h;y++) for(let x=0;x<rect.w;x++) out[y][x]=src[rect.y+y][rect.x+x];
  return out;
}
function putRectPixels(rect,data){
  pushHistory();
  for(let y=0;y<rect.h;y++) for(let x=0;x<rect.w;x++){
    const gx=rect.x+x, gy=rect.y+y; if(gx<0||gy<0||gx>=N||gy>=N) continue;
    const v=data[y][x]; if(v>=-1) setPixel(gx,gy,v);
  }
  draw();
}
function clearSelection(){ selActive=false; selA=selB=selRect=null; ovx.clearRect(0,0,ov.width,ov.height); }
function drawSelection(rect){
  if(!rect) return;
  ovx.save(); ovx.strokeStyle='#ffffff'; ovx.lineWidth=1; ovx.setLineDash([4,4]);
  const p=cellToPxOverlay(rect.x,rect.y); ovx.strokeRect(p.x+.5,p.y+.5, rect.w*Z-1, rect.h*Z-1); ovx.restore();
}
export const selectionAPI = {
  hasSelection: ()=> !!(selRect && selActive),
  getRect: ()=> selRect || {x:0,y:0,w:N,h:N},
  pick: ()=> pickRectPixels(selectionAPI.getRect()),
  clear: ()=> { clearSelection(); draw(); },
  setStamp: (piece)=> { stamping={ piece, x:0, y:0 }; }
};

/* ---------- histórico ---------- */
const snapshot = ()=> ({ N, Z, frames: deepCloneFrames(frames), fi, actions: actions.map(a=>({...a})) });
function restore(s){
  frames.splice(0, frames.length, ...deepCloneFrames(s.frames));
  if(s.actions) setState({ actions: s.actions.map(a=>({...a})) });
}
export function pushHistory(){
  undoStack.push(snapshot());
  if (undoStack.length>MAX_HISTORY) undoStack.shift();
  redoStack.length=0;
}
export function doUndo(){
  if (!undoStack.length) return;
  const cur = snapshot();
  const prev = undoStack.pop();
  redoStack.push(cur); restore(prev); draw();
}
export function doRedo(){
  if (!redoStack.length) return;
  const cur = snapshot();
  const next = redoStack.pop();
  undoStack.push(cur); restore(next); draw();
}

/* ---------- pequenos transforms ---------- */
export const transforms = {
  mirrorH(){ pushHistory(); const f=frames[fi]; for(let y=0;y<N;y++) f[y].reverse(); draw(); },
  mirrorV(){ pushHistory(); const f=frames[fi]; for(let y=0;y<Math.floor(N/2);y++){ [f[y],f[N-1-y]]=[f[N-1-y],f[y]]; } draw(); },
  rot90(){ pushHistory(); const f=frames[fi]; const out=makePixels(N); for(let y=0;y<N;y++) for(let x=0;x<N;x++) out[x][N-1-y]=f[y][x]; frames[fi]=out; draw(); },
  rot180(){ pushHistory(); const f=frames[fi]; const out=makePixels(N); for(let y=0;y<N;y++) for(let x=0;x<N;x++) out[N-1-y][N-1-x]=f[y][x]; frames[fi]=out; draw(); },
  rot270(){ pushHistory(); const f=frames[fi]; const out=makePixels(N); for(let y=0;y<N;y++) for(let x=0;x<N;x++) out[N-1-x][y]=f[y][x]; frames[fi]=out; draw(); }
};

/* ---------- NES export strict (stub JSON: tiles e pal) ---------- */
export function exportNESStrict(dirName='sprite_set'){
  // deixa o CHR/ASM real para o passo seguinte; aqui validamos grade 16×16 -> 8×8 tiles
  const T = UNIVERSES.NKOTC.tile; // 8
  const okTile = (N % T) === 0;
  const meta = { okTile, tile:T, size:N };
  console.log('NES strict meta', meta);
}