// /scripts/knockout.js
// Lightweight, DOM-agnostic knockout (matting) utility.
// Accepts an image-like source and returns a canvas with transparent background around the subject.
//
// API
//   async knockoutProcess(imgBitmap, options) -> { fullCanvas: HTMLCanvasElement, size_out: [W, H] }
//
// Options (tuned for Doodles art):
//   - ink (number): base black threshold mixed with Otsu (default 64)
//   - gap (number): morphology sign: >0 dilate, <0 erode magnitude (default -1)
//   - edge (number): Sobel magnitude threshold for guard wall (default 18)
//   - edge_dilate (number): dilation iters for edges (default 1; set 0 to disable)
//   - edge_pad (number): extra pixels around ROI where edges are nulled (default 1)
//   - seam (0|1): add a small horizontal seam at ROI bottom (default 1=on)
//   - keep_radius (number): protective halo (dilate ink) to preserve light details near ink (default 0)
//   - peel_iters (number): iterations of peelOutside (default 5; you can set 8, etc.)
//   - min_island_area (number): remove small fg islands not touching protection (default 0=off)
//   - feather (number): blur radius in px for alpha soften (default 1.2)
//   - bg_tol, padding: reserved
//   - erase_mask (ImageBitmap/canvas/img|null): zones to cut (0 alpha), unless ink is protected
//   - erase_keep_ink (boolean): keep black/ink even if inside erase_mask (default true)
//   - preserve_mask (ImageBitmap/canvas/img|null): zones to FORCE keep (alpha 255) and protect during peel
//
// Notes
// - No DOM lookups. Operates only on the provided bitmap/canvas.
// - Returned canvas preserves original pixel size (no scaling).

/* =============== Internal helpers (not exported) =============== */
function toGray(imgData){
  const {data,width,height} = imgData;
  const gray = new Uint8Array(width*height);
  for(let i=0,j=0;i<data.length;i+=4,j++){
    const r=data[i], g=data[i+1], b=data[i+2];
    gray[j] = Math.min(255, (0.299*r + 0.587*g + 0.114*b) | 0);
  }
  return gray;
}

function otsu(gray){
  const hist=new Float64Array(256);
  for(let i=0;i<gray.length;i++) hist[gray[i]]++;
  const total=gray.length;
  let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
  let sumB=0,wB=0,varMax=0,thr=96;
  for(let t=0;t<256;t++){
    wB+=hist[t]; if(wB===0) continue;
    const wF=total-wB; if(wF===0) break;
    sumB+=t*hist[t];
    const mB=sumB/wB, mF=(sum-sumB)/wF;
    const vb=wB*wF*(mB-mF)*(mB-mF);
    if(vb>varMax){ varMax=vb; thr=t; }
  }
  return thr|0;
}

function dilate(m,W,H,it=1){
  let a=m.slice(0);
  for(let k=0;k<it;k++){
    const pad=new Uint8Array((W+2)*(H+2));
    for(let y=0;y<H;y++) pad.set(a.subarray(y*W,(y+1)*W),(y+1)*(W+2)+1);
    const out=new Uint8Array(W*H);
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        let mx=0;
        for(let dy=0;dy<3;dy++) for(let dx=0;dx<3;dx++) mx=Math.max(mx,pad[(y+dy)*(W+2)+(x+dx)]);
        out[y*W+x]=mx>0?1:0;
      }
    }
    a=out;
  }
  return a;
}

function erode(m,W,H,it=1){
  let a=m.slice(0);
  for(let k=0;k<it;k++){
    const pad=new Uint8Array((W+2)*(H+2));
    for(let y=0;y<H;y++) pad.set(a.subarray(y*W,(y+1)*W),(y+1)*(W+2)+1);
    const out=new Uint8Array(W*H);
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        let mn=1;
        for(let dy=0;dy<3;dy++) for(let dx=0;dx<3;dx++) mn=Math.min(mn,pad[(y+dy)*(W+2)+(x+dx)]);
        out[y*W+x]=mn>0?1:0;
      }
    }
    a=out;
  }
  return a;
}

function sobelMag(g,W,H){
  const out=new Uint8Array(W*H);
  const get=(x,y)=>g[Math.max(0,Math.min(H-1,y))*W + Math.max(0,Math.min(W-1,x))];
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const gx=(-1*get(x-1,y-1)+1*get(x+1,y-1)+-2*get(x-1,y)+2*get(x+1,y)+-1*get(x-1,y+1)+1*get(x+1,y+1));
      const gy=(-1*get(x-1,y-1)-2*get(x,y-1)-1*get(x+1,y-1)+1*get(x-1,y+1)+2*get(x,y+1)+1*get(x+1,y+1));
      out[y*W+x]=Math.min(255, Math.hypot(gx,gy)|0);
    }
  }
  return out;
}

function floodBG(muro,isBgLike,W,H,rgbaFlat){
  const N=W*H;
  const bg=new Uint8Array(N);
  const q=new Uint32Array(N);
  let qs=0,qe=0;
  function push(p){
    if(bg[p]||muro[p]) return;
    if(isBgLike && !isBgLike(p,rgbaFlat)) return;
    bg[p]=1; q[qe++]=p;
  }
  for(let x=0;x<W;x++){ push(x); push((H-1)*W+x); }
  for(let y=0;y<H;y++){ push(y*W); push(y*W+(W-1)); }
  while(qs<qe){
    const p=q[qs++], x=p%W, y=(p/W)|0;
    const neigh=[p-1,p+1,p-W,p+W];
    for(const u of neigh){
      if(u<0||u>=N) continue;
      const ux=u%W, uy=(u/W)|0;
      if(Math.abs(ux-x)+Math.abs(uy-y)!==1) continue;
      if(bg[u]||muro[u]) continue;
      if(isBgLike && !isBgLike(u,rgbaFlat)) continue;
      bg[u]=1; q[qe++]=u;
    }
  }
  return bg;
}

function peelOutside(fg,protect,W,H,it=1){
  let out=fg.slice(0);
  for(let k=0;k<it;k++){
    const nxt=out.slice(0);
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const i=y*W+x;
        if(out[i]===0 || protect[i]===1) continue;
        if((x>0&&out[i-1]===0)||(x<W-1&&out[i+1]===0)||(y>0&&out[i-W]===0)||(y<H-1&&out[i+W]===0)) nxt[i]=0;
      }
    }
    out=nxt;
  }
  return out;
}

function keepOnlyTouchingAnchor(fg, anchor, W, H){
  const N = W*H;
  const vis = new Uint8Array(N);
  const out = new Uint8Array(N); // ricostruita con sole componenti valide
  const q = new Uint32Array(N);

  for (let i=0;i<N;i++){
    if (fg[i]===0 || vis[i]) continue;

    // BFS della componente FG
    let qs=0, qe=0; q[qe++]=i; vis[i]=1;
    let touches = false;
    const comp = [];

    while(qs<qe){
      const p=q[qs++]; comp.push(p);
      if (anchor[p]===1) touches = true;

      const neigh=[p-1,p+1,p-W,p+W];
      for(const u of neigh){
        if(u<0||u>=N||vis[u]) continue;
        if(fg[u]===1){ vis[u]=1; q[qe++]=u; }
      }
    }

    // Se la componente tocca l’ancora (ink/protect), la teniamo
    if (touches){
      for (const p of comp) out[p]=1;
    }
  }
  return out;
}

// Remove small FG islands that are not touching protection
function dropSmallIslands(fg, protect, W, H, minArea=300){
  if (minArea <= 0) return fg;
  const N = W*H;
  const vis = new Uint8Array(N);
  const out = fg.slice(0);
  const q = new Uint32Array(N);

  for (let i=0;i<N;i++){
    if (out[i]===0 || vis[i]) continue;

    // if touches protection, keep (but mark visited component)
    if (protect[i]===1){
      let qs=0, qe=0; q[qe++]=i; vis[i]=1;
      while(qs<qe){
        const p=q[qs++], neigh=[p-1,p+1,p-W,p+W];
        for(const u of neigh){
          if(u<0||u>=N||vis[u]) continue;
          if(out[u]===1){ vis[u]=1; q[qe++]=u; }
        }
      }
      continue;
    }

    // BFS the component to compute area
    let qs=0, qe=0, area=0; q[qe++]=i; vis[i]=1;
    const comp = [];
    while(qs<qe){
      const p=q[qs++]; comp.push(p); area++;
      const neigh=[p-1,p+1,p-W,p+W];
      for(const u of neigh){
        if(u<0||u>=N||vis[u]) continue;
        if(out[u]===1){ vis[u]=1; q[qe++]=u; }
      }
    }

    if (area < minArea){
      for (const p of comp) out[p]=0;
    }
  }
  return out;
}

function bitmapToBinaryMask(bmp, W, H){
  if(!bmp || bmp.width!==W || bmp.height!==H) return null;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const x=c.getContext('2d'); x.drawImage(bmp,0,0);
  const a=x.getImageData(0,0,W,H).data;
  const m=new Uint8Array(W*H);
  for(let i=0,j=0;j<W*H;i+=4,j++) m[j] = a[i+3]>0 ? 1 : 0;
  return m;
}

/* =========================== Public API =========================== */
/**
 * Knockout (matting) producing a canvas with clean alpha around ink/edges.
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} imgBitmap
 * @param {object} opts
 * @returns {Promise<{fullCanvas: HTMLCanvasElement, size_out: [number, number]}>}
 */
export async function knockoutProcess(imgBitmap, opts = {}){
  const {
    ink=64,
    gap=-1,
    edge=18,
    edge_dilate=1,
    edge_pad=1,
    seam=1,
    keep_radius=0,
    peel_iters=5,
    min_island_area=0,
    bg_tol=24, feather=1.2, padding=24,
    erase_mask = null,
    erase_keep_ink = true,
    preserve_mask = null
  } = opts;

  const W=imgBitmap.width, H=imgBitmap.height;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const cx=c.getContext('2d'); cx.drawImage(imgBitmap,0,0);
  const imgData=cx.getImageData(0,0,W,H);

  // 1) Base masks: ink & morphology
  const gray=toGray(imgData);
  const thrInk=Math.round(0.5*(0.8*otsu(gray))+0.5*ink)|0;

  let ink_mask=new Uint8Array(W*H);
  for(let i=0;i<ink_mask.length;i++) ink_mask[i]=gray[i]<=thrInk?1:0;

  let ink_morph = (gap>=0) ? dilate(ink_mask,W,H,gap) : erode(ink_mask,W,H,-gap);
  const CLEAN=1;
  ink_morph = dilate(erode(ink_morph,W,H,CLEAN),W,H,CLEAN);

  // Protective halo around ink (and later union with preserve)
  let protectPlus = (keep_radius>0) ? dilate(ink_morph, W, H, Math.max(1, keep_radius)) : ink_morph;

  // Rasterize preserve/erase masks
  const preserveMask = bitmapToBinaryMask(preserve_mask, W, H);
  const eraseMask    = bitmapToBinaryMask(erase_mask, W, H);

  // Include preserve in protection (blocks peel)
  if (preserveMask){
    const merged = new Uint8Array(W*H);
    for(let i=0;i<merged.length;i++) merged[i] = (protectPlus[i] || preserveMask[i]) ? 1 : 0;
    protectPlus = merged;
  }

  // Edge guard
  const mag=sobelMag(gray,W,H);
  const edge_bin=new Uint8Array(W*H);
  for(let i=0;i<edge_bin.length;i++) edge_bin[i]=mag[i]>=edge?1:0;
  const edge_dil = (edge_dilate>0) ? dilate(edge_bin,W,H,edge_dilate) : edge_bin;

// 2) ROI & barriers
// ROI = ink OR preserve (serve solo per annullare edges nel rect)
const roiMask = new Uint8Array(W*H);
for (let i=0;i<roiMask.length;i++) {
  roiMask[i] = (ink_morph[i] || (preserveMask && preserveMask[i])) ? 1 : 0;
}

let minx=W,miny=H,maxx=-1,maxy=-1;
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (roiMask[y*W+x]) {
  if (x<minx) minx=x; if (x>maxx) maxx=x;
  if (y<miny) miny=y; if (y>maxy) maxy=y;
}
const rect = (maxx>=0) ? [minx,miny,(maxx-minx+1),(maxy-miny+1)] : [0,0,W,H];
const [rx,ry,rw,rh] = rect;

// Annulla edges dentro/attorno al ROI
const edge_dil2 = edge_dil.slice(0);
const padX = Math.max(0, edge_pad|0);
const x0 = Math.max(0, rx - padX), y0 = Math.max(0, ry - padX);
const x1 = Math.min(W-1, rx + rw + padX), y1 = Math.min(H-1, ry + rh + padX);
for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) edge_dil2[y*W+x] = 0;

// 🔑 Barriera SOLO dall'inchiostro (niente preserve qui!)
const guard = Math.max(1, (gap>0 ? gap : 0) + 1);
const ink_barrier = dilate(ink_morph, W, H, guard);

// Optional seam
const seamMask = new Uint8Array(W*H);
if (seam) {
  const yS = Math.min(H-1, ry+rh), xL = Math.max(0, rx-2), xR = Math.min(W-1, rx+rw+2);
  for (let y=yS;y<=Math.min(H-1,yS+1);y++)
    for (let x=xL;x<=xR;x++) seamMask[y*W+x] = 1;
}

const muro = new Uint8Array(W*H);
for (let i=0;i<muro.length;i++) muro[i] = (ink_barrier[i] || edge_dil2[i] || seamMask[i]) ? 1 : 0;


  // 3) Flood BG & peel using protection
  const rgbaFlat=imgData.data;
  const bg=floodBG(muro,null,W,H,rgbaFlat);
  let fg=new Uint8Array(W*H);
  for(let i=0;i<fg.length;i++) fg[i]=bg[i]===0?1:0;

  // Force preserve areas to FG immediately (both for peel protection and final alpha)
  if (preserveMask){
    for (let i=0;i<fg.length;i++) if (preserveMask[i]) fg[i] = 1;
  }

  // Peel outside while keeping protectPlus intact
  fg=peelOutside(fg,protectPlus,W,H,peel_iters);

  // Optional: drop tiny islands not touching protection
  if (min_island_area>0){
    fg=dropSmallIslands(fg,protectPlus,W,H,min_island_area);
  }

  fg = keepOnlyTouchingAnchor(fg, protectPlus, W, H);
  // 4) Build alpha (apply erase, then preserve wins), feather
  const alphaCanvas=document.createElement('canvas'); alphaCanvas.width=W; alphaCanvas.height=H;
  const actx=alphaCanvas.getContext('2d');
  const rgba=new Uint8ClampedArray(W*H*4);

  for(let i=0;i<W*H;i++){
    // base visibility = FG or ink
    let a = (fg[i]===1 || ink_morph[i]===1) ? 255 : 0;

    // erase: cut to zero unless pixel is ink (and keep_ink) or later preserved
    if (eraseMask && eraseMask[i]){
      const keepInk = (erase_keep_ink && ink_morph[i]===1);
      if (!keepInk) a = 0;
    }

    // preserve: force alpha 255 (wins over erase)
    if (preserveMask && preserveMask[i]) a = 255;

    rgba[i*4+3]=a;
  }

  actx.putImageData(new ImageData(rgba,W,H),0,0);

  if (feather > 0){
    // 1) blur
    const blurC = document.createElement('canvas'); blurC.width=W; blurC.height=H;
    const bctx  = blurC.getContext('2d');
    bctx.filter = `blur(${feather}px)`;
    bctx.drawImage(alphaCanvas, 0, 0);

    // 2) clip blur to hard mask (avoid bleeding)
    const HARD = new Uint8Array(W*H);
    for (let i=0;i<W*H;i++) HARD[i] = (fg[i]===1 || ink_morph[i]===1) ? 1 : 0;

    const MARGIN = 1;
    const CLIP   = (MARGIN>0) ? dilate(HARD, W, H, MARGIN) : HARD;

    const bd = bctx.getImageData(0,0,W,H);
    const a  = bd.data;
    for (let i=0, j=0; j<W*H; i+=4, j++){
      if (!CLIP[j]) a[i+3] = 0;
    }

    actx.clearRect(0,0,W,H);
    actx.putImageData(bd, 0, 0);
  }

  // 5) Edge color decontamination: pull inner colors
  const shrinkIters = 1; // 1–2 px is usually enough
  const aData = actx.getImageData(0,0,W,H).data;
  const aBin  = new Uint8Array(W*H);
  for (let i=0,j=0; j<W*H; i+=4, j++) aBin[j] = aData[i+3] > 0 ? 1 : 0;

  const aBinE = erode(aBin, W, H, shrinkIters);

  // Rasterize shrink alpha
  const shrinkAlpha = document.createElement('canvas');
  shrinkAlpha.width = W; shrinkAlpha.height = H;
  {
    const sctx = shrinkAlpha.getContext('2d');
    const aRGBA = new Uint8ClampedArray(W*H*4);
    for (let i=0; i<W*H; i++) aRGBA[i*4+3] = aBinE[i] ? 255 : 0;
    sctx.putImageData(new ImageData(aRGBA, W, H), 0, 0);
  }

  // Inner color only
  const innerColor = document.createElement('canvas');
  innerColor.width = W; innerColor.height = H;
  {
    const ictx = innerColor.getContext('2d');
    ictx.drawImage(imgBitmap, 0, 0);                // original colors
    ictx.globalCompositeOperation = 'destination-in';
    ictx.drawImage(shrinkAlpha, 0, 0);              // keep only inner pixels
  }

  // Composite with full (feathered) alpha silhouette
  const masked = document.createElement('canvas');
  masked.width = W; masked.height = H;
  {
    const mctx = masked.getContext('2d');
    mctx.drawImage(innerColor, 0, 0);
    mctx.globalCompositeOperation = 'destination-in';
    mctx.drawImage(alphaCanvas, 0, 0);
  }

  return { fullCanvas: masked, size_out: [W, H] };
}
