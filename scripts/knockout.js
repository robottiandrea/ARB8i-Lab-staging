//
// /scripts/knockout.js
// Lightweight, DOM-agnostic knockout (matting) utility.
// Accepts an image-like source and returns a canvas with transparent background around the subject.
//
// API
//   async knockoutProcess(imgBitmap, options) -> { fullCanvas: HTMLCanvasElement, size_out: [W, H] }
// Options (all optional, tuned for Doodles art):
//   - ink (number): base black threshold used with Otsu mix (default 64)
//   - gap (number): morphology sign: >0 dilate, <0 erode magnitude (default -1)
//   - edge (number): Sobel magnitude threshold for guard wall (default 18)
//   - bg_tol (number): reserved (default 24). Kept for compatibility, not currently used.
//   - feather (number): blur radius in px for alpha soften (default 1.2)
//   - padding (number): reserved (default 24).
//
// Notes
// - No DOM lookups. Operates only on the provided bitmap/canvas.
// - Returned canvas preserves original pixel size (no scaling).
//

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

/* =========================== Public API =========================== */
/**
 * Knockout (matting) producing a canvas with clean alpha around ink/edges.
 * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement|OffscreenCanvas} imgBitmap
 * @param {object} opts
 * @returns {Promise<{fullCanvas: HTMLCanvasElement, size_out: [number, number]}>}
 */
export async function knockoutProcess(imgBitmap, opts = {}){
  const {
    ink=64, gap=-1, edge=18, bg_tol=24, feather=1.2, padding=24
  } = opts;

  const W=imgBitmap.width, H=imgBitmap.height;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const cx=c.getContext('2d'); cx.drawImage(imgBitmap,0,0);
  const imgData=cx.getImageData(0,0,W,H);

  // 1) base masks
  const gray=toGray(imgData);
  const thrInk=Math.round(0.5*(0.8*otsu(gray))+0.5*ink)|0;

  let ink_mask=new Uint8Array(W*H);
  for(let i=0;i<ink_mask.length;i++) ink_mask[i]=gray[i]<=thrInk?1:0;

  let ink_morph = (gap>=0) ? dilate(ink_mask,W,H,gap) : erode(ink_mask,W,H,-gap);
  const CLEAN=1;
  ink_morph = dilate(erode(ink_morph,W,H,CLEAN),W,H,CLEAN);

  const mag=sobelMag(gray,W,H);
  const edge_bin=new Uint8Array(W*H);
  for(let i=0;i<edge_bin.length;i++) edge_bin[i]=mag[i]>=edge?1:0;
  const edge_dil=dilate(edge_bin,W,H,1);

  // 2) ROI / barriers
  let minx=W,miny=H,maxx=-1,maxy=-1;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(ink_morph[y*W+x]){
    if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y;
  }
  const rect = (maxx>=0) ? [minx,miny,(maxx-minx+1),(maxy-miny+1)] : [0,0,W,H];
  const [rx,ry,rw,rh]=rect;

  const edge_dil2=edge_dil.slice(0);
  const x0=Math.max(0,rx-1), y0=Math.max(0,ry-1), x1=Math.min(W-1,rx+rw+1), y1=Math.min(H-1,ry+rh+1);
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) edge_dil2[y*W+x]=0;

  const guard=Math.max(1,gap>0?gap:0)+1;
  const ink_barrier=dilate(ink_mask,W,H,guard);
  const seam=new Uint8Array(W*H);
  const yS=Math.min(H-1,ry+rh), xL=Math.max(0,rx-2), xR=Math.min(W-1,rx+rw+2);
  for(let y=yS;y<=Math.min(H-1,yS+1);y++) for(let x=xL;x<=xR;x++) seam[y*W+x]=1;

  const muro=new Uint8Array(W*H);
  for(let i=0;i<muro.length;i++) muro[i]=(ink_barrier[i]||edge_dil2[i]||seam[i])?1:0;

  // 3) flood BG & peel halo
  const rgbaFlat=imgData.data;
  const bg=floodBG(muro,null,W,H,rgbaFlat);
  let fg=new Uint8Array(W*H);
  for(let i=0;i<fg.length;i++) fg[i]=bg[i]===0?1:0;
  fg=peelOutside(fg,ink_morph,W,H,5);

  // 4) alpha compose and feather
  const alphaCanvas=document.createElement('canvas'); alphaCanvas.width=W; alphaCanvas.height=H;
  const actx=alphaCanvas.getContext('2d');
  const rgba=new Uint8ClampedArray(W*H*4);
  for(let i=0;i<W*H;i++){ rgba[i*4+3]=(fg[i]===1||ink_morph[i]===1)?255:0; }
  actx.putImageData(new ImageData(rgba,W,H),0,0);

  if(feather>0){
    const blurC=document.createElement('canvas'); blurC.width=W; blurC.height=H;
    const bctx=blurC.getContext('2d');
    bctx.filter=`blur(${feather}px)`;
    bctx.drawImage(alphaCanvas,0,0);
    actx.clearRect(0,0,W,H);
    actx.drawImage(blurC,0,0);
  }

  // 5) result canvas with destination-in
  const masked=document.createElement('canvas'); masked.width=W; masked.height=H;
  const mctx=masked.getContext('2d');
  mctx.drawImage(imgBitmap,0,0);
  mctx.globalCompositeOperation='destination-in';
  mctx.drawImage(alphaCanvas,0,0);

  return { fullCanvas: masked, size_out: [W,H] };
}
