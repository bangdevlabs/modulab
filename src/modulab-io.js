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

/* ---------- GitHub remoto (Contents API) ---------- */
export const github = (()=>{
  let conf = { owner:'', repo:'', branch:'main', token:'', box:'' };

  const base = () => `https://api.github.com/repos/${conf.owner}/${conf.repo}/contents`;
  const headers = () => ({ 'Authorization': `token ${conf.token}`, 'Accept':'application/vnd.github+json' });

  const b64utf8 = (s)=> btoa(unescape(encodeURIComponent(s)));
  const b64bin  = (u8)=>{ let b=''; for(let i=0;i<u8.length;i++) b+=String.fromCharCode(u8[i]); return btoa(b); };

  const isConnected = ()=> !!(conf.owner && conf.repo && conf.branch && conf.token && conf.box);
  const connect = ({ owner, repo, branch='main', token, boxName })=>{
    conf = { owner, repo, branch, token, box: boxName };
  };

  async function _get(path){
    const r = await fetch(`${base()}/${encodeURIComponent(path)}?ref=${encodeURIComponent(conf.branch)}`, { headers: headers() });
    if (r.status===404) return null;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function _put(path, base64, message){
    const prev = await _get(path);
    const body = { message, content: base64, branch: conf.branch, ...(prev?.sha?{sha:prev.sha}:{}) };
    const r = await fetch(`${base()}/${encodeURIComponent(path)}`, {
      method:'PUT', headers:{ ...headers(), 'Content-Type':'application/json' }, body:JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }

  function _dir(kind){
    const root = `modulab/${conf.box}`;
    if (kind==='project') return `${root}/projects`;
    if (kind==='piece')   return `${root}/pieces`;
    if (kind==='sprite')  return `${root}/sprites`;
    if (kind==='chr')     return `${root}/assets/chr`;
    if (kind==='nam')     return `${root}/assets/nam`;
    if (kind==='attr')    return `${root}/assets/nam`;
    if (kind==='pal')     return `${root}/assets/pal`;
    return root;
  }
  function _path(kind, name){
    if (kind==='chr'||kind==='nam'||kind==='attr'||kind==='pal') return `${_dir(kind)}/${name}`;
    return `${_dir(kind)}/${name}.json`;
  }

  async function saveJSON(kind, name, data){
    if(!isConnected()) throw new Error('Git não conectado');
    return _put(_path(kind,name), b64utf8(JSON.stringify(data,null,2)), `modulab: save ${kind}/${name}`);
  }
  async function loadJSON(kind, name){
    if(!isConnected()) throw new Error('Git não conectado');
    const got = await _get(_path(kind,name)); if(!got) throw new Error('404');
    const text = decodeURIComponent(escape(atob(String(got.content||'').replace(/\n/g,''))));
    return JSON.parse(text);
  }
  async function list(kind){
    if(!isConnected()) throw new Error('Git não conectado');
    const r = await fetch(`${base()}/${encodeURIComponent(_dir(kind))}?ref=${encodeURIComponent(conf.branch)}`, { headers: headers() });
    if (r.status===404) return [];
    if (!r.ok) throw new Error(await r.text());
    const arr = await r.json();
    return (Array.isArray(arr)?arr:[]).filter(it=>it.type==='file').map(it=>it.name.replace(/\.json$/,''));
  }
  async function saveBytes(kind, name, bytes){
    if(!isConnected()) throw new Error('Git não conectado');
    return _put(_path(kind,name), b64bin(bytes), `modulab: save ${kind}/${name}`);
  }

  return { connect, isConnected, saveJSON, loadJSON, list, saveBytes };
})();