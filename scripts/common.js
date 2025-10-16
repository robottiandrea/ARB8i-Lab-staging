(function(){
  const META_SOURCES = ['./Doodles_all_metadata.json'];
  let metaReady=false, metaIndex=null;
  let doodleIndex=null, triedDoodleIndex=false;

  function ipfsToHttps(u){
    if(!u) return u;
    if(u.startsWith('ipfs://')){
      const hash = u.replace('ipfs://','').replace(/^ipfs\//,'');
      return `https://dweb.link/ipfs/${hash}`;
    }
    return u;
  }
  function pickId(obj, fallback){ return obj?.id ?? obj?.tokenId ?? obj?.token_id ?? obj?.index ?? fallback ?? null; }
  function pickImage(obj){ return obj?.image ?? obj?.image_url ?? obj?.imageUrl ?? null; }

  async function ensureMetaIndex(){
    if(metaReady) return;
    for(const src of META_SOURCES){
      try{
        const r = await fetch(src, {cache:'no-store'}); if(!r.ok) continue;
        const data = await r.json(); const map = new Map();
        if(Array.isArray(data)){
          for(const it of data){ const id=pickId(it); const img=pickImage(it);
            if(id!=null && img) map.set(String(id), ipfsToHttps(String(img))); }
        }else if(data && typeof data==='object'){
          for(const [k,v] of Object.entries(data)){
            const id=pickId(v,k); const img=(typeof v==='string')?v:pickImage(v);
            if(id!=null && img) map.set(String(id), ipfsToHttps(String(img)));
          }
        }
        if(map.size){ metaIndex = map; metaReady = true; return; }
      }catch{}
    }
    metaIndex = null; metaReady = true;
  }
  async function ensureDoodleIndex(){
    if(triedDoodleIndex) return;
    triedDoodleIndex = true;
    try{ const r=await fetch('./doodles/index.json',{cache:'no-store'});
         if(r.ok) doodleIndex = await r.json(); }catch{}
  }
  async function buildCandidateUrls(id){
    const urls=[]; const key = String(id);
    await ensureMetaIndex();
    if(metaIndex && metaIndex.has(key)) urls.push(metaIndex.get(key));
    await ensureDoodleIndex();
    if(doodleIndex && doodleIndex[key]) urls.push(String(doodleIndex[key]));
    urls.push(`./doodles/thumbs/${key}.png`,`./doodles/thumbs/${key}.jpg`,
              `./doodles/${key}.png`,`./doodles/${key}.jpg`);
    return urls;
  }
  function tryLoadIntoPreview(previewEl, id, url){
    return new Promise(resolve=>{
      const img = new Image(); img.decoding='async'; img.alt=`Anteprima Doodle #${id}`;
      img.onload = ()=>{ if(previewEl.dataset.id===String(id)){ previewEl.innerHTML=''; previewEl.appendChild(img); resolve(true);} else resolve(false); };
      img.onerror = ()=> resolve(false);
      img.src = url;
    });
  }

  function normalizeId(v, max=9999){
    const s = String(v||'').trim().replace(/\D+/g,'');
    if(s==='') return {value:'', valid:false, empty:true};
    const n = parseInt(s,10);
    if(Number.isFinite(n) && n>=0 && n<=max) return {value:String(n), valid:true, empty:false};
    return {value:s, valid:false, empty:false};
  }

  /* ==== “Input con X” automatico per tutti gli .id-input ==== */
  function ensureId(el){
    if(!el.id) el.id = 'ocid_' + Math.random().toString(36).slice(2,8);
    return el.id;
  }
  function wrapInInputClear(el){
    const p = el.parentElement;
    if(p && p.classList && p.classList.contains('input-clear')) return p;
    const w = document.createElement('div');
    w.className = 'input-clear';
    if(p){ p.insertBefore(w, el); w.appendChild(el); }
    return w;
  }
  function addClearToInput(input, afterClear){
    if(!input) return;
    const id = ensureId(input);
    const wrap = wrapInInputClear(input);
    if(wrap.querySelector(`.clear-btn[data-clear-for="${id}"]`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clear-btn';
    btn.setAttribute('data-clear-for', id);
    btn.setAttribute('aria-label', 'Pulisci');
    wrap.appendChild(btn);

    const toggle = () => btn.classList.toggle('show', !!input.value);
    input.addEventListener('input', toggle);

    btn.addEventListener('click', () => {
      input.value = '';
      // Hook globale (facoltativo per le pagine)
      if (typeof window.OC?.onIdCleared === 'function'){
        try { window.OC.onIdCleared(input); } catch(_){}
      }
      if (typeof afterClear === 'function'){
        try { afterClear(); } catch(_){}
      }
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.focus();
      toggle();
    });

    toggle();
  }
  function autoClearInputs(selector='.id-input'){
    document.querySelectorAll(selector).forEach(el => addClearToInput(el));
  }

  // Retro-compat con Trait Viewer (se lo usi lì)
  function wireClear(inputId, afterClear){
    const inp = document.getElementById(inputId);
    if(!inp) return;
    addClearToInput(inp, afterClear);
  }

  /* ==== Mini-anteprima Doodle e controllo unico ==== */
  function createIdPreview({input, preview, defaultId='8929', max=99999}){
    async function apply(id){
      if(!preview) return;
      const val = (id||id===0) ? String(id) : '';
      if(!val){ return reset(); }
      preview.style.display='block';
      preview.dataset.id = val;
      preview.classList.add('loading');
      preview.innerHTML = `<span class="id-badge">#${val}</span>`;
      const urls = await buildCandidateUrls(val);
      for(const url of urls){ if(preview.dataset.id!==val) return; const ok = await tryLoadIntoPreview(preview, val, url); if(ok) break; }
      preview.classList.remove('loading');
    }
    function reset(){ return apply(defaultId); }

    if(input){
      input.addEventListener('input', ()=>{
        const s = input.value.replace(/\D+/g,'');
        if(s!==input.value) input.value = s;
        if(s===''){ reset(); return; }
        const n = parseInt(s,10);
        if(Number.isFinite(n) && n>=0 && n<=max) apply(n);
      });
    }
    reset();
    return { apply, reset };
  }

function initIdControl(opts){
  const {
    input,            // CSS selector o HTMLElement
    preview,          // CSS selector o HTMLElement (opzionale)
    button,           // CSS selector o HTMLElement (opzionale)
    defaultId='8929',
    max=99999,

    // --- NUOVO: persistenza & deep-link ---
    persistKey=null,  // es. 'lastId' → salva/riprende da localStorage
    urlParam=null,    // es. 'id' → legge da ?id=
    cleanUrlParam=true,

    // --- page-specific hooks ---
    linkUpdater=null, // es. (id|null) => updateCardLinksWithId(id)
    onApply,          // (id) quando clicchi il bottone o Enter con ID valido
    onValidChange,    // (isValid, state)
    onClear           // () quando clicchi la X
  } = opts || {};

  const inputEl   = typeof input==='string'  ? document.querySelector(input)  : input;
  const previewEl = typeof preview==='string'? document.querySelector(preview): preview;
  const buttonEl  = typeof button==='string' ? document.querySelector(button) : button;
  if(!inputEl) return null;

  // X automatica
  addClearToInput(inputEl, ()=>{
    // pulizia storage
    if (persistKey) localStorage.removeItem(persistKey);
    // link senza id
    if (typeof linkUpdater === 'function') linkUpdater(null);
    // preview default
    if (previewEl) {
      const prev = createIdPreview({ input: inputEl, preview: previewEl, defaultId, max });
      prev.reset?.(); // garantisce default
    }
    if (typeof onClear === 'function') onClear();

    // inoltre svuota anche il value e notifica input
    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', {bubbles:true}));
  });

  // preview live condivisa
  const prevCtrl = previewEl ? createIdPreview({ input: inputEl, preview: previewEl, defaultId, max }) : null;

  // Stato validità + gestione bottone
  const setValidity = ()=>{
    const st = normalizeId(inputEl.value, max);
    if(buttonEl) buttonEl.disabled = !st.valid;
    if(typeof onValidChange==='function') onValidChange(!!st.valid, st);
    return st;
  };
  inputEl.addEventListener('input', setValidity);
  inputEl.addEventListener('keydown', e=>{
    if(e.key==='Enter' && onApply){
      const st = normalizeId(inputEl.value, max);
      if(st.valid){
        e.preventDefault();
        if (persistKey) localStorage.setItem(persistKey, st.value);
        if (typeof linkUpdater==='function') linkUpdater(st.value);
        onApply(st.value);
      }
    }
  });
  if(buttonEl && onApply){
    buttonEl.addEventListener('click', ()=>{
      const st = normalizeId(inputEl.value, max);
      if(st.valid){
        if (persistKey) localStorage.setItem(persistKey, st.value);
        if (typeof linkUpdater==='function') linkUpdater(st.value);
        onApply(st.value);
      }
    });
  }

  // Hydrate: ?id= → altrimenti localStorage → altrimenti default
  (function hydrate(){
    let hydrated = false;
    const sp = new URLSearchParams(location.search);

    if(urlParam && sp.has(urlParam)){
      const raw = sp.get(urlParam);
      const st = normalizeId(raw, max);
      inputEl.value = st.valid ? st.value : '';
      inputEl.dispatchEvent(new Event('input', {bubbles:true}));
      if(st.valid){
        if (persistKey) localStorage.setItem(persistKey, st.value);
        if (typeof linkUpdater==='function') linkUpdater(st.value);
        prevCtrl?.apply?.(st.value);
      }else{
        prevCtrl?.reset?.();
      }
      if(cleanUrlParam){
        sp.delete(urlParam);
        const q = sp.toString();
        history.replaceState(null, '', location.pathname + (q?('?'+q):''));
      }
      hydrated = true;
    }

    if(!hydrated && persistKey){
      const last = localStorage.getItem(persistKey);
      const st = normalizeId(last, max);
      if(st.valid){
        inputEl.value = st.value;
        inputEl.dispatchEvent(new Event('input', {bubbles:true}));
        prevCtrl?.apply?.(st.value);
        if (typeof linkUpdater==='function') linkUpdater(st.value);
        hydrated = true;
      }
    }

    if(!hydrated){
      prevCtrl?.reset?.(); // default 8929
      inputEl.dispatchEvent(new Event('input', {bubbles:true}));
    }
  })();

  // prima valutazione
  setValidity();

  return {
    get value(){ const st=normalizeId(inputEl.value, max); return st.valid?st.value:null; },
    set value(v){ inputEl.value = (v==null ? '' : String(v)); inputEl.dispatchEvent(new Event('input',{bubbles:true})); },
    resetPreview(){ prevCtrl?.reset?.(); },
    applyPreview(id){ prevCtrl?.apply?.(id); }
  };
}


    // ==== Crea DOM standard per la riga ID (preview SX + input con X + bottone opz.) ====
  function mountIdRow(containerSel, {
    inputId = 'tokenId',
    previewId = null,
    buttonId = null,
    buttonText = null,              // se null => nessun bottone
    buttonClass = 'btn-outline',    // es. 'id-btn' in index, 'btn-outline' in editor
    buttonContainer = null,         // se vuoi appendere il bottone altrove (es. dentro .id-cta)
    showPreview = true,
    placeholder = '8929',
    maxLen = 4
  } = {}){
    const container = (typeof containerSel==='string')
      ? document.querySelector(containerSel)
      : containerSel;
    if(!container) return null;

    // wrapper riga allineato agli stili di common.css (.id-row, .id-preview, .id-input)
    const row = document.createElement('div');
    row.className = 'id-row';

    // preview SX (facoltativa)
    let previewEl = null;
    if(showPreview){
      previewEl = document.createElement('div');
      previewEl.className = 'id-preview';
      if(previewId) previewEl.id = previewId;
      previewEl.innerHTML = '<span class="id-badge">#—</span>';
      row.appendChild(previewEl);
    }

    // input numerico con X (la X viene aggiunta da addClearToInput/initIdControl)
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'id-input';
    inputEl.id = inputId;
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('pattern', '[0-9]*');
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('maxlength', String(maxLen));
    inputEl.setAttribute('placeholder', placeholder);
    row.appendChild(inputEl);

    // bottone (opzionale)
    let btnEl = null;
    if(buttonText){
      btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.className = buttonClass;
      if(buttonId) btnEl.id = buttonId;
      btnEl.textContent = buttonText;
      btnEl.disabled = true;   // si abilita da initIdControl

      if(buttonContainer){
        const bc = (typeof buttonContainer==='string')
          ? document.querySelector(buttonContainer)
          : buttonContainer;
        if(bc){ bc.appendChild(btnEl); }
        else  { row.appendChild(btnEl); }
      }else{
        row.appendChild(btnEl);
      }
    }

    // monta nel container
    container.innerHTML = '';
    container.appendChild(row);

    return { row, input: inputEl, preview: previewEl, button: btnEl };
  }

  // API esposte
    window.OC = Object.assign(window.OC||{}, {
    normalizeId,
    wireClear,              // compat
    addClearToInput,        // opzionale
    autoClearInputs,        // X auto per tutti gli .id-input
    createIdPreview,        // opzionale
    initIdControl,          // inizializzatore unico
    mountIdRow              // crea il markup standard della riga ID
  });


  // X automatica su tutti gli .id-input presenti
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => autoClearInputs());
  } else {
    autoClearInputs();
  }
})();
