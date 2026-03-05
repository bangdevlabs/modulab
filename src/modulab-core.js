/* =====================================================
   modulab-core.js — Core (estado vivo + utilitários)
   Mantém compat com 1.1 e adiciona universos LegoBox
   ===================================================== */

export const $    = (q) => document.querySelector(q);
export const $all = (q) => Array.from(document.querySelectorAll(q));
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const makePixels  = (n) => Array.from({length:n}, () => Array.from({length:n}, () => -1));
export const makePattern = (n) => Array.from({length:n}, () => Array.from({length:n}, () => 0));
export const deepCloneFrames = (fs) => fs.map(f => f.map(r => r.slice()));

export const hexToRgba = (hex) => {
  const h = String(hex || '').replace('#','');
  let r=0,g=0,b=0,a=255;
  if (h.length === 6) { r=parseInt(h.slice(0,2),16); g=parseInt(h.slice(2,4),16); b=parseInt(h.slice(4,6),16); }
  else if (h.length === 8){ r=parseInt(h.slice(0,2),16); g=parseInt(h.slice(2,4),16); b=parseInt(h.slice(4,6),16); a=parseInt(h.slice(6,8),16); }
  return [r||0,g||0,b||0,a||255];
};
export const download = (url, name) => { const a=document.createElement('a'); a.href=url; a.download=name; a.click(); };

/* ---------- Universos / Paletas ---------- */
function nesMasterPalette() {
  return [
    '#7C7C7C','#0000FC','#0000BC','#4428BC','#940084','#A80020','#A81000','#881400',
    '#503000','#007800','#006800','#005800','#004058','#000000','#000000','#000000',
    '#BCBCBC','#0078F8','#0058F8','#6844FC','#D800CC','#E40058','#F83800','#E45C10',
    '#AC7C00','#00B800','#00A800','#00A844','#008888','#000000','#000000','#000000',
    '#F8F8F8','#3CBCFC','#6888FC','#9878F8','#F878F8','#F85898','#F87858','#FCA044',
    '#F8B800','#B8F818','#58D854','#58F898','#00E8D8','#787878','#000000','#000000',
    '#FCFCFC','#A4E4FC','#B8B8F8','#D8B8F8','#F8B8F8','#F8A4C0','#F0D0B0','#FCE0A8',
    '#F8D878','#D8F878','#B8F8B8','#B8F8D8','#00FCFC','#F8D8F8','#000000','#000000'
  ];
}
function lucasLeChuckPalette(){
  return [
    '#0b0e13',
    '#0a1633','#0e2159','#14307a','#1c449c',
    '#0c2f2e','#115247','#1a7a64','#26a58a',
    '#2a1033','#3c1d5c','#542b7f','#7241a3',
    '#3b0b1a','#5a1d2c','#7b2c3f','#a44559',
    '#2b1b08','#4a2a0d','#6a3a13','#8f531f',
    '#2e2e2e','#4b4b4b','#6e6e6e','#9a9a9a','#cfcfcf','#ffffff',
    '#0fd2ff','#5ce1ff','#b3f0ff','#ffe08a','#ffd146'
  ];
}
function mcuPalette(){
  // MCU-8 — índices 0-7 mapeiam 1:1 para mcu8.h
  // índice 0 = transparente no jogo (mostrado como cor escura no editor)
  return [
    '#202020', // 0: transparente (game)
    '#000000', // 1: preto
    '#880000', // 2: vermelho escuro
    '#808080', // 3: cinza
    '#FFA500', // 4: laranja
    '#008000', // 5: verde
    '#800080', // 6: roxo
    '#FFFF00', // 7: amarelo
  ];
}
export const UNIVERSES = {
  NKOTC: { id:'NKOTC', name:'NKOTC - NES 8×8',    tile:8,  maxColors:4,  defaultSize:256, palette:()=>nesMasterPalette().slice(0,32) },
  CB:    { id:'CB',    name:'CB - LUCAS 32×32',   tile:32, maxColors:32, defaultSize:256, palette:()=>lucasLeChuckPalette() },
  MCU:   { id:'MCU',   name:'MCU - BangDev 16×16', tile:16, maxColors:8,  defaultSize:16,  palette:()=>mcuPalette() }
};
export const BG_THEMES = {
  dark:{ checkerA:'#1b2130', checkerB:'#151a26', pageBg:'#0f1116' },
  light:{ checkerA:'#e9eef5', checkerB:'#cfd7e4', pageBg:'#fbfcff' }
};
export const PAT_N = 8;
export const DITHER = {
  CHECK:[[0,1],[1,0]],
  LA2x2:[[0,2],[3,1]],
  LA4x4:[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
};

/* ---------- State “vivo” (ES modules friendly) ---------- */
const _state = {
  currentUniverse:'NKOTC',
  N:256, Z:16,
  showGrid:true, wrapPreview:false, showOnion:false,
  palette: UNIVERSES.NKOTC.palette(),
  selColorIx:1, brushSize:1,

  frames:[ makePixels(256) ],
  fi:0,
  actions:[], // [{id, startFrame, endFrame, fps}]

  pattern: makePattern(PAT_N),
  patternAltIx:0,

  ditherOn:false, ditherAltIx:0, ditherMode:'LA2x2',
  stencilOn:false, stencilProtectedIx:0,

  // controla color cycling (range e par)
  cc: { running:false, timer:null, start:1, end:4, ms:200, pair:null },

  lastIssues:[],
  undoStack:[], redoStack:[], MAX_HISTORY:100,

  playing:false, playTimer:null, bgTheme:'dark'
  
};


// “live bindings”
export let currentUniverse=_state.currentUniverse;
export let N=_state.N, Z=_state.Z;
export let showGrid=_state.showGrid, wrapPreview=_state.wrapPreview, showOnion=_state.showOnion;
export let palette=_state.palette, selColorIx=_state.selColorIx, brushSize=_state.brushSize;
export let frames=_state.frames, fi=_state.fi;
export let actions=_state.actions;
export let pattern=_state.pattern, patternAltIx=_state.patternAltIx;
export let ditherOn=_state.ditherOn, ditherAltIx=_state.ditherAltIx, ditherMode=_state.ditherMode;
export let cc = _state.cc;
export let stencilOn=_state.stencilOn, stencilProtectedIx=_state.stencilProtectedIx;
export let lastIssues=_state.lastIssues;
export const undoStack=_state.undoStack, redoStack=_state.redoStack, MAX_HISTORY=_state.MAX_HISTORY;
export let playing=_state.playing, playTimer=_state.playTimer, bgTheme=_state.bgTheme;

// --- manter as live bindings sincronizadas com _state ---
function _syncLive(){
  ({
    currentUniverse, N, Z, showGrid, wrapPreview, showOnion,
    palette, selColorIx, brushSize, frames, fi,
    pattern, patternAltIx, ditherOn, ditherAltIx, ditherMode,
    cc, stencilOn, stencilProtectedIx, lastIssues,
    playing, playTimer, bgTheme, actions
  } = _state);
}
// chama 1x ao carregar o módulo
_syncLive();

// setState seguro (atualiza _state e reflete nas live bindings)
export function setState(patch = {}){
  // (A) troca de universo: atualiza paleta automaticamente
  if ('currentUniverse' in patch){
    _state.currentUniverse = patch.currentUniverse;
    _state.palette = UNIVERSES[_state.currentUniverse].palette();
  }

  // (B) color cycling: mescla ao invés de substituir
  if ('cc' in patch){
    _state.cc = { ..._state.cc, ...patch.cc };
  }

  // (C) aplica o resto normalmente
  for (const k of Object.keys(patch)){
    if (k === 'currentUniverse' || k === 'cc') continue;
    if (k in _state) _state[k] = patch[k];
  }

  _syncLive();
}

// ok deixar:
export const presetConf = ()=> {
  const u = UNIVERSES[_state.currentUniverse];
  return { tile:u.tile, maxColors:u.maxColors };
};