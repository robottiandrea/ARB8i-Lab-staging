//
// /scripts/recolor.js
// Lightweight SVG recoloring helpers for Lottie-SVG renderers.
// Works directly on an SVGElement. No DOM lookups outside the provided node.
//
// Exports:
//   - tagAllLayersWithNames(animation)  // annotate DOM with data-name from Lottie layer names
//   - getLayerRoots(svg, name)          // find roots tagged with data-name
//   - getLayerShapesByName(svg, name)   // all shapes under those roots
//   - setLayerFlatByName(svg, name, color)
//   - setLayerGradientStopsByName(svg, name, hexList[, orientation='horizontal'])
//   - setSoftLightByName(svg, name, opacity=0.8)
//
// Notes:
// - orientation: 'horizontal' → x1=0,y1=0,x2=100%,y2=0; 'vertical' → x1=0,y1=0,x2=0,y2=100%
// - All operations are in-place on the given SVG element.
//

/* ======================== Utilities ======================== */
export function tagAllLayersWithNames(animation){
  // Walk lottie renderer elements and set data-name on corresponding DOM nodes
  const tag=(el)=>{
    const name=el?.data?.nm;
    const dom=el?.layerElement || el?.baseElement || el?.parentContainer || null;
    if(name && dom?.setAttribute) dom.setAttribute('data-name', name);
    if(el?.elements?.length) el.elements.forEach(tag);
  };
  const arr = (animation?.renderer?.elements || []);
  arr.forEach(tag);
}

export function getLayerRoots(svg,name){
  return [...svg.querySelectorAll(`[data-name="${name}"]`)];
}

export function getLayerShapesByName(svg,name){
  const roots=getLayerRoots(svg,name), set=new Set();
  roots.forEach(r=>{
    r.querySelectorAll('path,polygon,rect,circle,ellipse,use,g').forEach(n=>set.add(n));
  });
  return [...set];
}

function forceFill(node,val){
  node.setAttribute('fill',val);
  node.style.setProperty('fill',val,'important');
}

function ensureDefs(svg){
  let d=svg.querySelector('defs');
  if(!d){
    d=document.createElementNS('http://www.w3.org/2000/svg','defs');
    svg.prepend(d);
  }
  return d;
}

function injectLinearGradient(svg,id,stops,attrs){
  const defs=ensureDefs(svg);
  const lg=document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
  lg.setAttribute('id',id);
  Object.entries(attrs).forEach(([k,v])=>lg.setAttribute(k,v));
  stops.forEach(s=>{
    const st=document.createElementNS('http://www.w3.org/2000/svg','stop');
    st.setAttribute('offset',s.offset);
    st.setAttribute('stop-color',s.color);
    if(s.opacity!=null) st.setAttribute('stop-opacity',s.opacity);
    lg.appendChild(st);
  });
  defs.appendChild(lg);
  return id;
}

/* ======================== Public API ======================== */
export function setLayerFlatByName(svg,name,color){
  getLayerShapesByName(svg,name).forEach(n=>forceFill(n,color));
}

export function setLayerGradientStopsByName(svg,name,hexList,orientation='horizontal'){
  const id=`grad_${name}_${Date.now()}`;
  const n=hexList.length;
  const stops=hexList.map((c,i)=>({offset:(n===1?0:(i/(n-1)))*100+'%', color:c}));
  const attrs=(orientation==='horizontal')
    ? {x1:'0%',y1:'0%',x2:'100%',y2:'0%'}
    : {x1:'0%',y1:'0%',x2:'0%',y2:'100%'};
  injectLinearGradient(svg,id,stops,attrs);
  getLayerShapesByName(svg,name).forEach(n=>forceFill(n,`url(#${id})`));
}

export function setSoftLightByName(svg,name,opacity=.8){
  getLayerRoots(svg,name).forEach(r=>{
    r.style.mixBlendMode='soft-light';
    r.style.opacity=String(opacity);
  });
}
