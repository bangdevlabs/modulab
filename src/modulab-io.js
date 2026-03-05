/* =====================================================
   modulab-io.js — Export/Import + GitHub remoto
   - PNG, JSON, Spritesheet básico
   - Contents API (sem localStorage), por box/universo
   ===================================================== */

import { hexToRgba, download, makePixels, deepCloneFrames, N, frames, fi, palette } from './modulab-core.js';

/* ---------- EXPORT: PNG (frame atual) ---------- */
export function exportPNG(){
  const off=document.createElement('canvas'); off.width=N; off.height=N;
  const ox=off.getContext('2d'), id=ox.createImageData(N,N), px=frames[fi];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const i=(y*N+x)*4, ix=px[y][x];
    const [r,g,b,a]= ix>=0 ? hexToRgba(palette[ix]) : [0,0,0,0];
    id.data[i]=r; id.data[i+1]=g; id.data[i+2]=b; id.data[i+3]=a;
  }
  ox.putImageData(id,0,0);
  download(off.toDataURL('image/png'), `modulab_${N}x${N}.png`);
}

/* ---------- EXPORT: JSON (projeto) ---------- */
export function exportJSON(){
  const data={ size:N, palette, frames };
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  download(url, `modulab_${N}x${N}.json`);
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}

/* ---------- EXPORT: spritesheet (básico) ---------- */
export function exportSpritesheet({layout='row'}={}){
  const W = layout==='col' ? N : N*frames.length;
  const H = layout==='col' ? N*frames.length : N;
  const off=document.createElement('canvas'); off.width=W; off.height=H;
  const ox=off.getContext('2d',{willReadFrequently:true});

  frames.forEach((f,idx)=>{
    const x0 = layout==='col' ? 0 : idx*N;
    const y0 = layout==='col' ? idx*N : 0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){
      const ix=f[y][x]; if (ix<0) continue;
      ox.fillStyle=palette[ix]; ox.fillRect(x0+x, y0+y, 1, 1);
    }
  });

  const meta={ frameWidth:N, frameHeight:N, count:frames.length, layout };
  download(off.toDataURL('image/png'), `sheet_${N}x${N}_${frames.length}.png`);

  const blob=new Blob([JSON.stringify(meta,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  download(url, `sheet_${N}x${N}.json`);
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}

/* ---------- IMPORT: JSON/PNG ---------- */
export async function importFromFile(file, policy='flex'){
  if (file.type==='image/png') return importPNG(file, policy);

  const txt = await file.text();
  const obj = JSON.parse(txt);
  if (!obj || typeof obj.size!=='number' || !Array.isArray(obj.frames)) throw new Error('JSON inválido');
  const S=obj.size|0, f0=obj.frames[0]; if (!Array.isArray(f0)||f0.length!==S||!Array.isArray(f0[0])||f0[0].length!==S) throw new Error('Frame não bate com size');

  for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const v=Number(f0[y][x]); f0[y][x]=Number.isFinite(v)?v:-1; }

  const filePal = Array.isArray(obj.palette) ? obj.palette.slice() : [];
  const mapIx = new Map();
  for(let i=0;i<filePal.length;i++){
    const hex=(filePal[i]||'').toLowerCase(); if(!hex) continue;
    let pi=palette.findIndex(p=>p.toLowerCase()===hex);
    if (pi<0){
      if (policy==='strict') throw new Error(`Cor ${hex} não existe na paleta`);
      palette.push(filePal[i]); pi=palette.length-1; // flex: agrega
    }
    mapIx.set(i, pi);
  }
  for(let y=0;y<S;y++) for(let x=0;x<S;x++){
    const v=f0[y][x]; if(v>=0){ const m=mapIx.has(v)?mapIx.get(v):v; f0[y][x]=(m<palette.length?m:-1); }
  }
  frames.splice(0, frames.length, f0);
}

async function importPNG(file, policy){
  return new Promise((resolve,reject)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{
      try{
        const S=img.width; if(img.width!==img.height) throw new Error('PNG precisa ser NxN');
        const off=document.createElement('canvas'); off.width=S; off.height=S; const ox=off.getContext('2d',{willReadFrequently:true});
        ox.drawImage(img,0,0);
        const id=ox.getImageData(0,0,S,S).data;
        const px=makePixels(S);
        for(let y=0;y<S;y++) for(let x=0;x<S;x++){
          const i=(y*S+x)*4, r=id[i], g=id[i+1], b=id[i+2], a=id[i+3];
          if (a===0){ px[y][x]=-1; continue; }
          const hex = `#${[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
          let pi=palette.findIndex(p=>p.toLowerCase()===hex.toLowerCase());
          if (pi<0){ if(policy==='strict'){ pi=-1; } else { palette.push(hex); pi=palette.length-1; } }
          px[y][x]=pi;
        }
        frames.splice(0, frames.length, px);
        resolve();
      }catch(err){ reject(err); }
      finally{ URL.revokeObjectURL(url); }
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Falha ao ler PNG')); };
    img.src=url;
  });
}

/* ---------- EXPORT: sprite16 JSON (formato MCU / BangDev) ---------- */
// Compatível com sprite16_load_json do engine C.
// Mapeamento de paleta: índice ModuLab → índice MCU-8 é 1:1.
// Célula vazia (-1) → índice 0 (transparente no engine).
export function exportSprite16JSON(){
  const px = frames[fi];
  const W = px[0].length, H = px.length;
  const data = [];
  for(let y=0;y<H;y++){
    const row=[];
    for(let x=0;x<W;x++){
      const ix=px[y][x];
      row.push(ix<0 ? 0 : ix); // -1 (vazio) vira 0 (transparente no engine)
    }
    data.push(row);
  }
  const obj = { type:'sprite16', width:W, height:H, palette:'MCU-8', data };
  const blob = new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  download(url, `sprite_${W}x${H}.json`);
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}


/* ---------- EXPORT: sprite atlas + JSON de animação (MCU / BangDev) ---------- */
// actions: [{id, startFrame, endFrame, fps}] em ordem de linha no atlas
// Gera dois downloads: <name>.atlas.png  e  <name>.anim.json
export function exportSpriteAtlas({ name='sprite', actions, frames, N, palette }){
  if(!actions || !actions.length){ alert('Nenhuma action definida.'); return; }
  const cols = Math.max(...actions.map(a => a.endFrame - a.startFrame + 1));
  const rows = actions.length;
  const cv = document.createElement('canvas');
  cv.width  = cols * N;
  cv.height = rows * N;
  const ctx = cv.getContext('2d');

  actions.forEach((action, rowIdx) => {
    for(let f = action.startFrame; f <= action.endFrame; f++){
      if(f >= frames.length) break;
      const colIdx = f - action.startFrame;
      const fr = frames[f];
      for(let y=0;y<N;y++) for(let x=0;x<N;x++){
        const ix = fr[y][x];
        if(ix >= 0){ ctx.fillStyle = palette[ix]; ctx.fillRect(colIdx*N+x, rowIdx*N+y, 1, 1); }
      }
    }
  });

  download(cv.toDataURL('image/png'), `${name}.atlas.png`);

  const meta = {
    type:'sprite-anim/v1',
    sprite: name,
    frame_w: N, frame_h: N,
    palette: 'MCU-8',
    actions: actions.map((a,i) => ({ id:a.id, row:i, frames:a.endFrame-a.startFrame+1, fps:a.fps }))
  };
  const blob = new Blob([JSON.stringify(meta,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  download(url, `${name}.anim.json`);
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}

/* ---------- IMPORT: sprite16 MCU (/assets/sprites/*.json) ---------- */
// Converte sprite16 JSON (índices MCU-8) para frame ModuLab.
// idx 0 = transparente → -1 no ModuLab; idx 1-7 = cores MCU-8.
export function importMCUSprite16(json){
  if(!json || json.type !== 'sprite16')
    throw new Error('importMCUSprite16: não é um sprite16 MCU válido.');
  const MCU8 = ['#000000','#000000','#8C1A1A','#808080','#FFA500','#008000','#800080','#FFFF00'];
  const W = json.width  || 16;
  const H = json.height || 16;
  const frame = Array.from({length:H}, (_,y) =>
    Array.from({length:W}, (_,x) => {
      const idx = json.data?.[y]?.[x] ?? 0;
      return idx === 0 ? -1 : Math.min(7, Math.max(0, idx));
    })
  );
  return { frame, palette: MCU8.slice(), W, H };
}

/* ---------- LegoBox remoto (servidor compartilhado da equipe) ---------- */
export const legobox = (()=>{
  let conf = { url:'', token:'' };

  const isConnected = ()=> !!(conf.url && conf.token);
  const connect = ({ url, token })=> { conf = { url: url.replace(/\/$/, ''), token }; };

  const writeHeaders = ()=> ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${conf.token}`
  });

  async function list(kind){
    if(!isConnected()) throw new Error('LegoBox não conectado');
    const r = await fetch(`${conf.url}/${kind}`);
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function loadJSON(kind, name){
    if(!isConnected()) throw new Error('LegoBox não conectado');
    const r = await fetch(`${conf.url}/${kind}/${encodeURIComponent(name)}`);
    if(r.status===404) throw new Error('404');
    if(!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function saveJSON(kind, name, data){
    if(!isConnected()) throw new Error('LegoBox não conectado');
    const r = await fetch(`${conf.url}/${kind}/${encodeURIComponent(name)}`, {
      method:'PUT', headers: writeHeaders(), body: JSON.stringify(data)
    });
    if(!r.ok) throw new Error(await r.text());
    return true;
  }
  async function deleteJSON(kind, name){
    if(!isConnected()) throw new Error('LegoBox não conectado');
    const r = await fetch(`${conf.url}/${kind}/${encodeURIComponent(name)}`, {
      method:'DELETE', headers: writeHeaders()
    });
    if(!r.ok) throw new Error(await r.text());
    return true;
  }

  return { connect, isConnected, saveJSON, loadJSON, deleteJSON, list };
})();