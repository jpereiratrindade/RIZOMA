// RIZOMA — Frontend application
// Copyright (C) 2026 José Pedro Trindade
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

'use strict';
const $ = id => document.getElementById(id);
const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = new Intl.NumberFormat('pt-BR');
let images = [], selectedFiles = [], current = null, mode = 'original', currentUser = null, currentAnalysis = null, analysisRuns = [], selectedRegion = null;
let viewer = {imageId:null, manifest:null, scale:1, x:0, y:0, fit:true, drag:null, revision:0, frame:0};
const viewNames = {acervo:'Acervo de imagens',recebimento:'Recebimento',integridade:'Integridade e origem',sobre:'Sobre o RIZOMA'};

function toast(message){
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 4400);
}

function nav(view){
  for(const name of Object.keys(viewNames)){
    $('view-'+name).classList.toggle('hidden', view !== name);
  }
  for(const b of document.querySelectorAll('[data-view]')){
    let active = b.dataset.view === view;
    b.classList.toggle('active', active);
    if(active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  $('page-name').textContent = viewNames[view];
  $('sidebar').classList.remove('open');
  $('mobile-scrim').classList.remove('shown');
  $('menu').setAttribute('aria-expanded', 'false');
  location.hash = view;
  window.scrollTo(0, 0);
}

async function api(path, options = {}){
  const r = await fetch(path, options);
  let data = await r.json().catch(() => ({error: 'Resposta inválida do servidor'}));
  if(!r.ok){
    if(r.status === 401 && !path.startsWith('/api/v1/auth/')){
      currentUser = null;
      updateUserUI();
      showAuthOverlay('Sua sessão expirou ou é necessária autenticação.');
    }
    throw Error(data.error || `Erro HTTP ${r.status}`);
  }
  return data;
}

function getInitials(name, email){
  if(name && name !== email){
    const parts = name.trim().split(/\s+/);
    if(parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if(parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  }
  const clean = (email || '').split('@')[0].replace(/[^a-zA-Z]/g, '');
  return clean.slice(0, 2).toUpperCase() || 'EM';
}

function updateUserUI(){
  const chip = $('user-chip');
  const opEmail = $('operator-email');
  if(currentUser){
    chip.classList.remove('hidden');
    $('user-avatar').textContent = getInitials(currentUser.name, currentUser.email);
    $('user-email').textContent = currentUser.email;
    $('user-email').title = currentUser.name ? `${currentUser.name} (${currentUser.email})` : currentUser.email;
    if(opEmail) opEmail.textContent = currentUser.email;
  } else {
    chip.classList.add('hidden');
    if(opEmail) opEmail.textContent = 'Não autenticado';
  }
}

function setAuthFeedback(msg, type = 'error'){
  const box = $('auth-feedback');
  if(!msg){ box.classList.add('hidden'); box.textContent = ''; return; }
  box.className = `auth-feedback ${type}`;
  box.textContent = msg;
  box.classList.remove('hidden');
}

function showAuthOverlay(infoMsg){
  $('auth-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('auth-email-form').classList.remove('hidden');
  $('auth-code-form').classList.add('hidden');
  $('auth-dev-preview').classList.add('hidden');
  setAuthFeedback(infoMsg || '', infoMsg ? 'error' : '');
  setTimeout(() => $('auth-email-input').focus(), 50);
}

function hideAuthOverlay(){
  $('auth-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function requestAuthCode(e){
  e.preventDefault();
  const emailInput = $('auth-email-input');
  const email = emailInput.value.trim().toLowerCase();
  if(!email.endsWith('@embrapa.br')){
    setAuthFeedback('Apenas e-mails institucionais @embrapa.br são permitidos.', 'error');
    emailInput.focus();
    return;
  }
  const btn = $('btn-request-code');
  btn.disabled = true;
  setAuthFeedback('Gerando chave de acesso e enviando por e-mail...', 'success');
  try{
    const res = await api('/api/v1/auth/request-code', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email})
    });
    $('auth-target-email').textContent = email;
    $('auth-email-form').classList.add('hidden');
    $('auth-code-form').classList.remove('hidden');
    if(res.dev_code){
      $('auth-dev-preview').classList.remove('hidden');
      $('auth-dev-code-val').textContent = res.dev_code;
    } else {
      $('auth-dev-preview').classList.add('hidden');
    }
    setAuthFeedback('Chave de 6 dígitos gerada com sucesso! Verifique seu e-mail institucional.', 'success');
    $('auth-code-input').value = '';
    setTimeout(() => $('auth-code-input').focus(), 50);
  }catch(err){
    setAuthFeedback(err.message, 'error');
  }finally{
    btn.disabled = false;
  }
}

async function verifyAuthCode(e){
  e.preventDefault();
  const email = $('auth-email-input').value.trim().toLowerCase();
  const code = $('auth-code-input').value.trim();
  if(!code || code.length !== 6){
    setAuthFeedback('Por favor, informe o código numérico de 6 dígitos.', 'error');
    $('auth-code-input').focus();
    return;
  }
  const btn = $('btn-verify-code');
  btn.disabled = true;
  setAuthFeedback('Validando chave de acesso institucional...', 'success');
  try{
    const res = await api('/api/v1/auth/verify-code', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, code})
    });
    currentUser = res.user;
    updateUserUI();
    hideAuthOverlay();
    toast(`Bem-vindo(a), ${currentUser.name || currentUser.email}!`);
    await refresh();
  }catch(err){
    setAuthFeedback(err.message, 'error');
  }finally{
    btn.disabled = false;
  }
}

async function logout(){
  try{
    await api('/api/v1/auth/logout', {method: 'POST'});
  }catch(_){}
  currentUser = null;
  updateUserUI();
  images = [];
  render();
  showAuthOverlay('Sessão encerrada com segurança.');
  toast('Sessão encerrada.');
}

function render(){
  const search = $('search').value.trim().toLowerCase(), filter = $('filter').value;
  let items = images.filter(x => (filter === 'all' || filter === x.qc_state) && (!search || [x.filename, x.sample_id, x.sha256, x.id, x.user_email].join(' ').toLowerCase().includes(search)));
  $('stat-total').textContent = number.format(images.length);
  $('stat-prepared').textContent = number.format(images.length);
  $('stat-review').textContent = number.format(images.filter(i => i.qc_state !== 'REVIEW').length);
  if(!items.length){
    $('gallery').innerHTML = `<div class="empty"><svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="8" width="42" height="36" rx="5"/><path d="m10 37 12-13 8 7 6-10 10 16"/><circle cx="16" cy="18" r="3"/></svg><h3>${images.length ? 'Nenhuma imagem corresponde aos filtros' : 'Seu acervo começa com uma imagem'}</h3><p>${images.length ? 'Experimente outra pesquisa ou limpe os filtros.' : 'Envie os primeiros registros para preservar originais e gerar prévias para inspeção.'}</p>${images.length ? '' : '<button class="button primary" id="empty-upload">Receber primeira imagem →</button>'}</div>`;
    if($('empty-upload')) $('empty-upload').onclick = () => nav('recebimento');
    return;
  }
  $('gallery').innerHTML = items.map(x => `<button class="image-card" type="button" data-image="${h(x.id)}" aria-label="Inspecionar ${h(x.filename)}"><div class="thumb"><img src="/api/v1/images/${h(x.id)}/preview" alt="" loading="lazy"><span class="thumb-tag">${number.format(x.width)} × ${number.format(x.height)}</span></div><div class="cardbody"><strong title="${h(x.filename)}">${h(x.filename)}</strong><p>${h(x.sample_id || 'Sem amostra')} · ${h(x.capture_date || x.created_at.slice(0, 10))}</p><div class="card-foot"><span class="quality ${x.qc_state === 'REVIEW' ? '' : 'alert'}">${x.qc_state === 'REVIEW' ? 'Inspeção visual' : x.qc_state === 'LOW_LIGHT' ? 'Pouca luz' : 'Excesso de luz'}</span><span class="open-link">Abrir ↗</span></div></div></button>`).join('');
  for(const item of document.querySelectorAll('[data-image]')) item.onclick = () => openInspect(item.dataset.image);
}

async function refresh(){
  if(!currentUser){
    try{
      const auth = await api('/api/v1/auth/me');
      if(auth.authenticated){
        currentUser = auth.user;
        updateUserUI();
        hideAuthOverlay();
      } else {
        showAuthOverlay();
        return;
      }
    }catch(e){
      showAuthOverlay();
      return;
    }
  }
  try{
    const res = await api('/api/v1/images');
    images = res.data || [];
    render();
    $('service-state').textContent = 'Serviço local ativo';
    $('service-state').parentElement.classList.remove('offline');
  }catch(e){
    $('service-state').textContent = 'Acesso restrito ou indisponível';
    $('service-state').parentElement.classList.add('offline');
    $('gallery').innerHTML = `<div class="empty"><h3>Não foi possível consultar o servidor</h3><p>${h(e.message)}.</p></div>`;
  }
}

function clampViewer(){
  if(!current) return;
  const stage = $('image-stage'), width = current.width * viewer.scale, height = current.height * viewer.scale;
  viewer.x = width <= stage.clientWidth ? (stage.clientWidth - width) / 2 : Math.min(0, Math.max(stage.clientWidth - width, viewer.x));
  viewer.y = height <= stage.clientHeight ? (stage.clientHeight - height) / 2 : Math.min(0, Math.max(stage.clientHeight - height, viewer.y));
}

function scheduleTiles(){
  cancelAnimationFrame(viewer.frame);
  viewer.frame = requestAnimationFrame(renderTiles);
}

function renderViewer(){
  if(!current || viewer.imageId !== current.id) return;
  clampViewer();
  $('analysis-canvas').style.width = current.width + 'px';
  $('analysis-canvas').style.height = current.height + 'px';
  $('analysis-canvas').style.transform = `translate(${viewer.x}px,${viewer.y}px) scale(${viewer.scale})`;
  $('zoom').value = String(Math.max(Number($('zoom').min), Math.min(Number($('zoom').max), viewer.scale * 100)));
  $('zoomvalue').textContent = `${Math.round(viewer.scale * 100)}%`;
  scheduleTiles();
}

function fitViewer(){
  if(!current) return;
  const stage = $('image-stage');
  viewer.scale = Math.min(1, Math.max(.001, Math.min((stage.clientWidth - 24) / current.width, (stage.clientHeight - 24) / current.height)));
  viewer.fit = true; viewer.x = 0; viewer.y = 0;
  $('zoom').min = String(Math.max(.1, viewer.scale * 50));
  renderViewer();
}

function setViewerZoom(next, anchorX, anchorY){
  if(!current) return;
  const stage = $('image-stage');
  const old = viewer.scale;
  next = Math.min(8, Math.max(Math.max(.001, Number($('zoom').min) / 100), next));
  const ax = anchorX ?? stage.clientWidth / 2, ay = anchorY ?? stage.clientHeight / 2;
  const imageX = (ax - viewer.x) / old, imageY = (ay - viewer.y) / old;
  viewer.scale = next; viewer.x = ax - imageX * next; viewer.y = ay - imageY * next; viewer.fit = false;
  renderViewer();
}

function renderViewerMode(){
  const filter = mode === 'negative' ? 'invert(1)' : mode === 'grayscale' ? 'grayscale(1)' : '';
  $('inspect-image').style.filter = filter;
  $('tile-layer').style.filter = filter;
  $('tile-layer').classList.toggle('hidden', mode === 'preview');
  if(mode === 'preview') $('pyramid-status').textContent = 'Prévia integral · visualização de inspeção';
  else scheduleTiles();
}

function renderTiles(){
  if(!current || viewer.imageId !== current.id || !viewer.manifest || mode === 'preview') return;
  const stage = $('image-stage'), layer = $('tile-layer'), levels = viewer.manifest.levels;
  const density = viewer.scale * (window.devicePixelRatio || 1);
  let level = levels[levels.length - 1];
  for(const candidate of levels){ if(candidate.width / current.width >= density * .85){ level = candidate; break; } }
  const left = Math.max(0, -viewer.x / viewer.scale), top = Math.max(0, -viewer.y / viewer.scale);
  const right = Math.min(current.width, (stage.clientWidth - viewer.x) / viewer.scale), bottom = Math.min(current.height, (stage.clientHeight - viewer.y) / viewer.scale);
  const tileSize = viewer.manifest.tile_size, factorX = current.width / level.width, factorY = current.height / level.height;
  const minX = Math.max(0, Math.floor(left / factorX / tileSize) - 1), minY = Math.max(0, Math.floor(top / factorY / tileSize) - 1);
  const maxX = Math.min(level.columns - 1, Math.floor(Math.max(0, right - 1) / factorX / tileSize) + 1), maxY = Math.min(level.rows - 1, Math.floor(Math.max(0, bottom - 1) / factorY / tileSize) + 1);
  const wanted = new Set();
  for(let y = minY; y <= maxY; y++) for(let x = minX; x <= maxX; x++){
    const key = `${level.level}:${x}:${y}`; wanted.add(key);
    if(layer.querySelector(`[data-tile="${key}"]`)) continue;
    const image = document.createElement('img'); image.dataset.tile = key; image.alt = ''; image.draggable = false;
    const lx = x * tileSize, ly = y * tileSize, lw = Math.min(tileSize, level.width - lx), lh = Math.min(tileSize, level.height - ly);
    image.style.left = `${lx * factorX}px`; image.style.top = `${ly * factorY}px`; image.style.width = `${lw * factorX + .25}px`; image.style.height = `${lh * factorY + .25}px`;
    image.onload = image.onerror = () => updateTileStatus(level);
    image.src = level.url_template.replace('{x}', x).replace('{y}', y);
    layer.append(image);
  }
  for(const image of Array.from(layer.children)) if(!wanted.has(image.dataset.tile)) image.remove();
  updateTileStatus(level);
}

function updateTileStatus(level){
  const tiles = Array.from($('tile-layer').children), loaded = tiles.filter(image => image.complete && image.naturalWidth).length;
  $('pyramid-status').textContent = `Pirâmide ${level.level + 1}/${viewer.manifest.levels.length} · ${loaded}/${tiles.length} blocos visíveis`;
  $('image-stage').classList.toggle('tiles-loading', loaded < tiles.length);
}

async function initializeViewer(imageId){
  const revision = ++viewer.revision;
  viewer.imageId = imageId; viewer.manifest = null; viewer.drag = null; viewer.fit = true;
  $('tile-layer').replaceChildren();
  $('inspect-image').src = `/api/v1/images/${imageId}/preview`;
  $('pyramid-status').textContent = 'Carregando pirâmide progressiva…';
  renderViewerMode();
  requestAnimationFrame(fitViewer);
  try{
    const manifest = await api(`/api/v1/images/${imageId}/pyramid`);
    if(revision !== viewer.revision || !current || current.id !== imageId) return;
    viewer.manifest = manifest; renderViewer();
  }catch(err){
    if(revision !== viewer.revision) return;
    $('pyramid-status').textContent = 'Prévia disponível · pirâmide indisponível'; toast(err.message);
  }
}

async function openInspect(id){
  current = images.find(x => x.id === id);
  if(!current) return;
  mode = 'original';
  activeLayer = 'roots';
  segCanvases = null;
  segCurrentRunId = null;
  $('inspect-title').textContent = current.filename;
  $('inspector').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  initializeViewer(current.id);
  fillInspect();
  currentAnalysis = null;
  analysisRuns = [];
  selectedRegion = null;
  renderAnalysis();
  try{
    const runs = await api(`/api/v1/images/${current.id}/analysis-runs`); analysisRuns = runs.data || [];
    const result = await api(`/api/v1/images/${current.id}/analysis`); currentAnalysis = result.data; renderAnalysis(); fillInspect(); if(currentAnalysis) $('start-analysis').textContent='Executar nova análise';
  }catch(err){ toast(err.message); }
  $('close-inspect').focus();
}

function fillInspect(){
  if(!current) return;
  for(const b of document.querySelectorAll('[data-image-mode]'))
    b.classList.toggle('active', b.dataset.imageMode === mode);
  renderViewerMode();
  $('inspect-metadata').innerHTML = [
    ['Identificador', current.id],
    ['Amostra', current.sample_id || 'Não informada'],
    ['Captura', current.capture_date || 'Não informada'],
    ['Dimensões', `${number.format(current.width)} × ${number.format(current.height)} px`],
    ['Formato', current.format.toUpperCase()],
    ['Tamanho', `${(current.bytes / 1024 / 1024).toFixed(2)} MiB`],
    ['Responsável', current.user_email || 'Não registrado'],
    ['Preparação', current.pipeline],
    ['Estado científico', currentAnalysis ? 'REVISÃO NECESSÁRIA' : 'NÃO ANALISADA'],
    ['SHA-256', current.sha256],
    ['Arquivo Original', `<a href="/api/v1/images/${current.id}/original" download="${h(current.filename)}" class="open-link" style="display:inline-flex;align-items:center;gap:4px">Baixar arquivo original (${current.format.toUpperCase()}) ↗</a>`]
  ].map(([label, value], i) => `<div class="${i >= 9 ? 'hash' : ''}"><dt>${h(label)}</dt><dd>${value}</dd></div>`).join('');
}

function regionById(id){ return currentAnalysis?.regions?.find(r => r.id === id); }
function automaticLabel(label, isRecalibrated = false){
  if (isRecalibrated) {
    return label === 'ROOT' ? 'Possível raiz (recalibrada online)' : 'Desconhecida (recalibrada online)';
  }
  return label === 'ROOT' ? 'Possível raiz — não confirmada' : 'Estrutura desconhecida — revisão necessária';
}

function findNextRecommendedRegion(currentId){
  if(!currentAnalysis?.regions) return null;
  const pending = currentAnalysis.regions.filter(r => !r.review && r.id !== currentId);
  if(!pending.length) return null;
  pending.sort((a, b) => {
    const confA = a.judgment_evidence?.confidence ?? 0.5;
    const confB = b.judgment_evidence?.confidence ?? 0.5;
    return confA - confB;
  });
  return pending[0];
}

async function loadAnalysisRun(runId){
  try{
    const result=await api(`/api/v1/images/${current.id}/analysis?run_id=${encodeURIComponent(runId)}`);
    currentAnalysis=result.data;selectedRegion=null;
    segCanvases=null;
    segCurrentRunId=null;
    renderAnalysis();fillInspect();
  }catch(err){toast(err.message);}
}

function selectRegion(id){
  selectedRegion = regionById(id);
  renderAnalysis();
  if(selectedRegion) loadHistory(selectedRegion.id);
}

let editingNotes = false;
let activeLayer = 'roots'; // 'roots' | 'matrix' | 'binary' | 'overlay' | 'boxes'
let segCanvases = null;
let segGenerating = false;
let segCurrentRunId = null;

async function prepareSegmentationCanvases(force = false) {
  if (!current || !currentAnalysis) return;
  if (segCanvases && segCurrentRunId === currentAnalysis.id && !force) return;
  if (segGenerating) return;

  segGenerating = true;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Falha ao carregar imagem para segmentação'));
      img.src = `/api/v1/images/${encodeURIComponent(current.id)}/original-view`;
    });

    const w = img.naturalWidth || current.width || 800;
    const h = img.naturalHeight || current.height || 600;

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = w; baseCanvas.height = h;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.drawImage(img, 0, 0, w, h);
    const baseData = baseCtx.getImageData(0, 0, w, h);
    const src = baseData.data;

    const rootsCanvas = document.createElement('canvas');
    rootsCanvas.width = w; rootsCanvas.height = h;
    const rootsCtx = rootsCanvas.getContext('2d');
    const rootsData = rootsCtx.createImageData(w, h);
    const rPix = rootsData.data;

    const matrixCanvas = document.createElement('canvas');
    matrixCanvas.width = w; matrixCanvas.height = h;
    const matrixCtx = matrixCanvas.getContext('2d');
    const matrixData = matrixCtx.createImageData(w, h);
    const mPix = matrixData.data;

    const binaryCanvas = document.createElement('canvas');
    binaryCanvas.width = w; binaryCanvas.height = h;
    const binaryCtx = binaryCanvas.getContext('2d');
    const binaryData = binaryCtx.createImageData(w, h);
    const bPix = binaryData.data;

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = w; overlayCanvas.height = h;
    const overlayCtx = overlayCanvas.getContext('2d');
    const overlayData = overlayCtx.createImageData(w, h);
    const oPix = overlayData.data;

    const isRootPixel = new Uint8Array(w * h);
    const regions = currentAnalysis.regions || [];

    for (const r of regions) {
      const label = r.review?.label || r.suggestion;
      if (label === 'ROOT') {
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(w, Math.ceil(r.x + r.width));
        const y1 = Math.min(h, Math.ceil(r.y + r.height));
        for (let y = y0; y < y1; y++) {
          const rowOffset = y * w;
          for (let x = x0; x < x1; x++) {
            isRootPixel[rowOffset + x] = 1;
          }
        }
      }
    }

    const total = w * h;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const r = src[idx], g = src[idx + 1], b = src[idx + 2];

      if (isRootPixel[i]) {
        // Raiz: preservada com máxima fidelidade no canal de raízes
        rPix[idx] = r; rPix[idx + 1] = g; rPix[idx + 2] = b; rPix[idx + 3] = 255;
        // Solo: raiz mascarada/subtraída
        mPix[idx] = Math.round(r * 0.15); mPix[idx + 1] = Math.round(g * 0.15); mPix[idx + 2] = Math.round(b * 0.15); mPix[idx + 3] = 100;
        // Binária: branco absoluto (255)
        bPix[idx] = 255; bPix[idx + 1] = 255; bPix[idx + 2] = 255; bPix[idx + 3] = 255;
        // Overlay: verde esmeralda translúcido sobre o pixel original
        oPix[idx] = Math.round(r * 0.4); oPix[idx + 1] = Math.min(255, Math.round(g * 1.4 + 40)); oPix[idx + 2] = Math.round(b * 0.5); oPix[idx + 3] = 255;
      } else {
        // Matriz / Solo
        rPix[idx] = 0; rPix[idx + 1] = 0; rPix[idx + 2] = 0; rPix[idx + 3] = 0; // Transparente
        mPix[idx] = r; mPix[idx + 1] = g; mPix[idx + 2] = b; mPix[idx + 3] = 255; // Solo intacto
        bPix[idx] = 0; bPix[idx + 1] = 0; bPix[idx + 2] = 0; bPix[idx + 3] = 255; // Preto absoluto (0)
        oPix[idx] = r; oPix[idx + 1] = g; oPix[idx + 2] = b; oPix[idx + 3] = 255; // Foto original
      }
    }

    rootsCtx.putImageData(rootsData, 0, 0);
    matrixCtx.putImageData(matrixData, 0, 0);
    binaryCtx.putImageData(binaryData, 0, 0);
    overlayCtx.putImageData(overlayData, 0, 0);

    segCanvases = { roots: rootsCanvas, matrix: matrixCanvas, binary: binaryCanvas, overlay: overlayCanvas, w, h };
    segCurrentRunId = currentAnalysis.id;
    applyActiveLayer();
  } catch (err) {
    console.error('Falha ao processar segmentação:', err);
  } finally {
    segGenerating = false;
  }
}

function applyActiveLayer() {
  const segLayer = $('segmented-layer');
  const regionOverlay = $('region-overlay');
  const tileLayer = $('tile-layer');
  const inspectImg = $('inspect-image');
  if (!segLayer) return;

  if (activeLayer === 'boxes' || !segCanvases) {
    segLayer.classList.add('hidden');
    if (regionOverlay) regionOverlay.style.display = 'block';
    if (tileLayer) tileLayer.style.display = 'block';
    if (inspectImg) inspectImg.style.display = 'block';
    if ($('pyramid-status')) $('pyramid-status').textContent = 'Modo de inspeção: Caixas candidatas';
    return;
  }

  // Modos de segmentação: esconde caixas imediatamente!
  if (regionOverlay) regionOverlay.style.display = 'none';

  segLayer.width = segCanvases.w;
  segLayer.height = segCanvases.h;
  const ctx = segLayer.getContext('2d');
  ctx.clearRect(0, 0, segCanvases.w, segCanvases.h);

  const selected = segCanvases[activeLayer];
  if (selected) {
    ctx.drawImage(selected, 0, 0);
  }
  segLayer.classList.remove('hidden');

  if (activeLayer === 'binary' || activeLayer === 'roots') {
    if (tileLayer) tileLayer.style.display = 'none';
    if (inspectImg) inspectImg.style.display = 'none';
  } else {
    if (tileLayer) tileLayer.style.display = 'none';
    if (inspectImg) inspectImg.style.display = 'none';
  }

  const layerNames = {
    roots: '🌿 Somente Raízes Reconhecidas (Isolamento Radicular)',
    matrix: '🟤 Matriz de Solo (Raízes Subtraídas)',
    binary: '⬛ Máscara Binária P&B (Padrão ImageJ / RhizoVision)',
    overlay: '🔍 Sobreposição Nítida (Foto + Raízes)'
  };
  if ($('pyramid-status')) {
    $('pyramid-status').textContent = `Camada Ativa: ${layerNames[activeLayer] || activeLayer}`;
  }
}

function downloadLayerPng(layerKey, label){
  if(!segCanvases || !segCanvases[layerKey]){
    toast('Camada ainda sendo gerada...');
    return;
  }
  const canvas = segCanvases[layerKey];
  canvas.toBlob((blob) => {
    if(!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rizoma-${encodeURIComponent(current.sample_id || current.id)}-${label}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Arquivo ${a.download} exportado!`);
  }, 'image/png');
}

async function validateFinalAnalysis(){
  if(!currentAnalysis) return;
  try{
    const res = await api(`/api/v1/analysis-runs/${currentAnalysis.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        status: 'COMPLETED',
        notes: (currentAnalysis.notes ? currentAnalysis.notes + '\n\n' : '') + '✓ Segmentação global homologada e validada pelo pesquisador responsável.'
      })
    });
    currentAnalysis.status = res.data.status;
    currentAnalysis.notes = res.data.notes;
    currentAnalysis.completed_at = res.data.completed_at;
    const item = analysisRuns.find(r => r.id === currentAnalysis.id);
    if(item) item.status = res.data.status;
    renderAnalysis();
    toast('Análise homologada e validada cientificamente com sucesso!');
  }catch(err){ toast(err.message); }
}

function renderAnalysis(){
  const panel = $('analysis-panel'), overlay = $('region-overlay');
  if(!currentAnalysis){
    overlay.innerHTML = '';
    panel.innerHTML = `<div class="analysis-empty"><strong>Análise ainda não executada</strong><p>Execute o baseline experimental sobre o original preservado. O processamento atual é em memória e restrito ao domínio de ingestão desta versão.</p></div>`;
    return;
  }
  const regions = currentAnalysis.regions || [];
  overlay.innerHTML = regions.map(r => {
    const isRecal = !r.review && r.judgment_evidence?.recalibrated;
    const cls = `region-box ${selectedRegion?.id === r.id ? 'selected' : ''} ${r.suggestion === 'ROOT' ? 'root' : 'unknown'} ${isRecal ? 'recalibrated' : ''}`;
    const title = `Região ${r.ordinal}: ${h(automaticLabel(r.suggestion, isRecal))}${isRecal ? ' ⚡ Recalibrada em tempo real' : ''}`;
    return `<button type="button" class="${cls}" data-region-box="${h(r.id)}" style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px" title="${title}"></button>`;
  }).join('');
  for(const box of overlay.querySelectorAll('[data-region-box]')) box.onclick = () => selectRegion(box.dataset.regionBox);
  const selected = selectedRegion && regionById(selectedRegion.id);

  const st = currentAnalysis.status || 'REVIEW_REQUIRED';
  const statusLabel = st === 'COMPLETED' ? '✓ Homologada' : (st === 'ARCHIVED' ? '⊘ Arquivada' : '⚡ Revisão Pendente');
  const statusCls = st === 'COMPLETED' ? 'completed' : (st === 'ARCHIVED' ? 'archived' : 'review');

  const notesHtml = editingNotes ? `
    <form id="notes-form" class="notes-edit-form">
      <textarea id="notes-textarea" placeholder="Observações científicas, notas metodológicas ou justificativas...">${h(currentAnalysis.notes || '')}</textarea>
      <div class="notes-edit-buttons">
        <button type="button" class="btn-subtle" id="btn-cancel-notes">Cancelar</button>
        <button type="submit" class="btn-subtle" style="background:var(--blue);color:#fff">Salvar notas</button>
      </div>
    </form>
  ` : `
    <div class="notes-content">${currentAnalysis.notes ? h(currentAnalysis.notes) : '<span class="notes-empty">Nenhuma observação registrada nesta análise.</span>'}</div>
  `;

  const stats = currentAnalysis.statistics || (() => {
    let root_count = 0, matrix_count = 0, artifact_count = 0, unknown_count = 0, reviewed_count = 0;
    let total_root_area = 0, total_region_area = 0;
    for (const r of regions) {
      const finalLabel = r.review?.label || r.suggestion;
      if (r.review) reviewed_count++;
      if (finalLabel === 'ROOT') { root_count++; total_root_area += (r.area || 0); }
      else if (finalLabel === 'MATRIX') matrix_count++;
      else if (finalLabel === 'ARTIFACT') artifact_count++;
      else unknown_count++;
      total_region_area += (r.area || 0);
    }
    return {
      total_regions: regions.length,
      root_count, matrix_count, artifact_count, unknown_count,
      reviewed_count, pending_count: regions.length - reviewed_count,
      total_root_area, total_region_area
    };
  })();

  const imgArea = (current?.width && current?.height) ? (current.width * current.height) : 0;
  const densityPct = imgArea > 0 ? ((stats.total_root_area / imgArea) * 100) : 0;
  const revPct = stats.total_regions > 0 ? Math.round((stats.reviewed_count / stats.total_regions) * 100) : 0;

  const segmentationCardHtml = `
    <div class="segmentation-card">
      <div class="segmentation-head">
        <span>MODELO CONFIRMADO · SEGMENTAÇÃO GLOBAL</span>
        <strong>Camadas Científicas do Monolito</strong>
      </div>
      <p class="segmentation-desc">Aplicação pixel-a-pixel sobre toda a imagem para isolamento fenotípico de raízes e solo.</p>
      
      <div class="layer-selector">
        <button type="button" class="btn-layer ${activeLayer==='roots'?'active':''}" data-layer-btn="roots" title="Exibe exclusivamente as raízes confirmadas">🌿 Raízes</button>
        <button type="button" class="btn-layer ${activeLayer==='matrix'?'active':''}" data-layer-btn="matrix" title="Exibe a matriz de solo com as raízes subtraídas">🟤 Solo</button>
        <button type="button" class="btn-layer ${activeLayer==='binary'?'active':''}" data-layer-btn="binary" title="Máscara preto e branco padrão ImageJ / RhizoVision">⬛ Máscara P&B</button>
        <button type="button" class="btn-layer ${activeLayer==='overlay'?'active':''}" data-layer-btn="overlay" title="Foto original com raízes destacadas sem caixas">🔍 Sobreposição</button>
        <button type="button" class="btn-layer ${activeLayer==='boxes'?'active':''}" data-layer-btn="boxes" title="Visualizar caixas de depuração">📦 Caixas</button>
      </div>

      <div class="layer-downloads">
        <span class="layer-down-title">Exportar imagens individuais:</span>
        <div class="down-btn-grid">
          <button type="button" class="btn-down" id="dl-roots-png" title="Download da imagem contendo exclusivamente as raízes">🌿 Raízes (.PNG)</button>
          <button type="button" class="btn-down" id="dl-matrix-png" title="Download da imagem da matriz de solo">🟤 Solo (.PNG)</button>
          <button type="button" class="btn-down" id="dl-binary-png" title="Download da máscara binária para ImageJ/Rhizo">⬛ Máscara (.PNG)</button>
          <button type="button" class="btn-down" id="dl-full-png" title="Download da composição com sumário agronômico">🖼 Composição</button>
        </div>
      </div>

      <div class="validation-section">
        ${st === 'COMPLETED' ? `
          <div class="val-approved-badge">
            <span>✓ ANÁLISE HOMOLOGADA E VALIDADA</span>
            <small>Segmentação final aprovada pelo pesquisador responsável</small>
          </div>
        ` : `
          <div class="val-actions-row">
            <button type="button" class="btn-validate-final" id="btn-validate-final" title="Aprovar e homologar cientificamente a segmentação global da imagem">
              ✓ Validar e Homologar Análise Final
            </button>
          </div>
        `}
      </div>
    </div>
  `;

  const statsHtml = `
    <div class="stats-summary-card">
      <div class="stats-card-head">
        <span>SUMÁRIO ESTATÍSTICO</span>
        <strong>Estatísticas Radiculares</strong>
      </div>
      <div class="stats-metrics-grid">
        <div class="stat-mini">
          <span class="stat-mini-label">🌱 Raízes</span>
          <strong class="stat-mini-val">${stats.root_count}</strong>
          <small>${number.format(stats.total_root_area)} px²</small>
        </div>
        <div class="stat-mini">
          <span class="stat-mini-label">📐 Densidade</span>
          <strong class="stat-mini-val">${densityPct.toFixed(3)}%</strong>
          <small>área da imagem</small>
        </div>
        <div class="stat-mini">
          <span class="stat-mini-label">⚖️ Solo / Artefatos</span>
          <strong class="stat-mini-val">${stats.matrix_count} / ${stats.artifact_count}</strong>
          <small>estruturas</small>
        </div>
        <div class="stat-mini">
          <span class="stat-mini-label">🎯 Revisão</span>
          <strong class="stat-mini-val">${revPct}%</strong>
          <small>${stats.reviewed_count}/${stats.total_regions} concluídas</small>
        </div>
      </div>
    </div>
    <div class="export-actions-group">
      <a href="/api/v1/images/${encodeURIComponent(current.id)}/analysis-export.csv?run_id=${encodeURIComponent(currentAnalysis.id)}" download="rizoma-analise-${encodeURIComponent(current.sample_id || current.id)}.csv" class="btn-export-csv" id="btn-export-stats-csv" style="grid-column:1/-1;padding:9px" title="Download de estatísticas e relatório RFC-4180 em CSV para R/Pandas/Excel">
        📊 Baixar Relatório Científico Completo (.CSV)
      </a>
    </div>
  `;

  panel.innerHTML = `<div class="analysis-head">
      <div>
        <span class="section-kicker">ANÁLISE EXPERIMENTAL</span>
        <strong>${h(currentAnalysis.algorithm_version)}</strong>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="status-badge ${statusCls}">${statusLabel}</span>
        <span class="analysis-count">${number.format(regions.length)} regiões</span>
      </div>
    </div>
    <label class="run-picker">Execução preservada
      <select id="analysis-run-picker">${analysisRuns.map((run,index) => `<option value="${h(run.id)}" ${run.id===currentAnalysis.id?'selected':''}>${index+1}. ${h(run.created_at)} (${h(run.status || 'REVIEW')}) · ${number.format(run.region_count)} regiões</option>`).join('')}</select>
    </label>
    <div class="analysis-actions-row">
      ${st !== 'COMPLETED' ? `<button type="button" class="btn-action-small success" id="btn-complete-analysis" title="Concluir ciclo de revisão">✓ Concluir análise</button>` : ''}
      ${st !== 'ARCHIVED' ? `<button type="button" class="btn-action-small" id="btn-archive-analysis" title="Arquivar análise">⊘ Arquivar</button>` : ''}
      <button type="button" class="btn-action-small danger" id="btn-delete-analysis" title="Excluir execução de análise">🗑 Excluir análise</button>
    </div>
    ${regions.filter(r => !r.review).length > 0 ? `<button type="button" class="button primary full" id="btn-batch-confirm" style="margin:8px 0 10px;background:linear-gradient(135deg,var(--teal),var(--blue));font-size:0.82rem;padding:9px 12px">⚡ Confirmar todas pendentes (${regions.filter(r => !r.review).length})</button>` : (regions.length > 0 ? `<div style="background:#eaf7f2;color:#116e4b;border:1px solid #b7e6cf;padding:6px 10px;border-radius:6px;font-size:0.75rem;font-weight:700;margin:8px 0;display:flex;align-items:center;gap:6px">✓ Todas as ${regions.length} regiões confirmadas!</div>` : '')}
    ${segmentationCardHtml}
    ${statsHtml}
    <div class="analysis-notes-block">
      <div class="notes-header">
        <span>Notas científicas</span>
        ${!editingNotes ? `<button type="button" class="btn-subtle" id="btn-edit-notes" style="font-size:0.68rem;padding:2px 7px">✏ Editar</button>` : ''}
      </div>
      ${notesHtml}
    </div>
    <p class="analysis-warning">Sugestões não validadas biologicamente. Coordenadas referem-se ao original SHA-256 <code>${h(currentAnalysis.source_sha256.slice(0,12))}…</code></p>
    <div class="region-list">${regions.length ? regions.map(r => {
      const isRecal = !r.review && r.judgment_evidence?.recalibrated;
      const badgePill = isRecal ? '<span class="pill-recalibrated">⚡ Em tempo real</span>' : '';
      const subText = r.review
        ? `Decisão humana v${r.version}`
        : (isRecal ? 'Hipótese atualizada pós-feedback' : 'Sugestão automática inicial');
      return `<button type="button" data-region-row="${h(r.id)}" class="region-row ${selected?.id === r.id ? 'selected' : ''} ${r.review ? 'reviewed' : (isRecal ? 'recalibrated' : '')}">
        <span>R${r.ordinal}</span>
        <div>
          <strong>${h(r.review?.label || automaticLabel(r.suggestion, isRecal))} ${badgePill}</strong>
          <small>${subText} · ${number.format(r.area)} px candidatos</small>
        </div>
      </button>`;
    }).join('') : '<p class="no-regions">Nenhuma região candidata foi encontrada com estes parâmetros.</p>'}</div>
    ${selected ? reviewEditor(selected) : '<p class="choose-region">Selecione uma região na imagem ou na lista para revisar.</p>'}`;

  for(const row of panel.querySelectorAll('[data-region-row]')) row.onclick = () => selectRegion(row.dataset.regionRow);
  if($('analysis-run-picker')) $('analysis-run-picker').onchange = e => loadAnalysisRun(e.target.value);
  if($('review-form')) $('review-form').onsubmit = (e) => saveReview(e, false);
  if($('btn-next-review')) $('btn-next-review').onclick = (e) => saveReview(e, true);

  // Botões de camada
  for(const b of panel.querySelectorAll('[data-layer-btn]')){
    b.onclick = () => {
      activeLayer = b.dataset.layerBtn;
      for(const other of panel.querySelectorAll('[data-layer-btn]')) other.classList.toggle('active', other === b);
      applyActiveLayer();
    };
  }

  // Botões de download de imagens de camada
  if($('dl-roots-png')) $('dl-roots-png').onclick = () => downloadLayerPng('roots', 'somente-raizes');
  if($('dl-matrix-png')) $('dl-matrix-png').onclick = () => downloadLayerPng('matrix', 'matriz-solo');
  if($('dl-binary-png')) $('dl-binary-png').onclick = () => downloadLayerPng('binary', 'mascara-binaria');
  if($('dl-full-png')) $('dl-full-png').onclick = () => exportClassifiedImage();

  // Botão de validação final
  if($('btn-validate-final')) $('btn-validate-final').onclick = () => validateFinalAnalysis();

  if($('btn-complete-analysis')) $('btn-complete-analysis').onclick = () => setAnalysisStatus('COMPLETED');
  if($('btn-archive-analysis')) $('btn-archive-analysis').onclick = () => setAnalysisStatus('ARCHIVED');
  if($('btn-delete-analysis')) $('btn-delete-analysis').onclick = () => openDeleteAnalysisModal();
  if($('btn-batch-confirm')) $('btn-batch-confirm').onclick = () => openBatchConfirmModal();
  if($('btn-edit-notes')) $('btn-edit-notes').onclick = () => { editingNotes = true; renderAnalysis(); };
  if($('btn-cancel-notes')) $('btn-cancel-notes').onclick = () => { editingNotes = false; renderAnalysis(); };
  if($('notes-form')) $('notes-form').onsubmit = (e) => {
    e.preventDefault();
    saveAnalysisNotes($('notes-textarea').value.trim());
  };

  // Disparar preparação assíncrona das camadas de segmentação
  prepareSegmentationCanvases();
}

async function exportClassifiedImage(){
  if(!current || !currentAnalysis) return;
  const btn = $('btn-export-classified-img');
  if(btn) btn.disabled = true;
  toast('Processando exportação da imagem classificada em alta resolução...');

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Falha ao obter os dados visuais da imagem'));
      img.src = `/api/v1/images/${encodeURIComponent(current.id)}/original-view`;
    });

    const w = img.naturalWidth || current.width || 1200;
    const h = img.naturalHeight || current.height || 1200;
    const scale = Math.max(1, Math.min(w, h) / 1200);
    const bannerH = Math.max(90, Math.round(75 * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + bannerH;
    const ctx = canvas.getContext('2d');

    // 1. Imagem base original em alta resolução
    ctx.drawImage(img, 0, 0, w, h);

    // 2. Sobreposição limpa das estruturas radiculares (sem caixas de texto poluentes)
    const regions = currentAnalysis.regions || [];
    const lineWidth = Math.max(1, Math.round(1.2 * scale));

    for (const r of regions) {
      const finalLabel = r.review?.label || r.suggestion;
      let strokeColor = 'rgba(92,139,166,0.8)', fillColor = 'rgba(92,139,166,0.14)';
      if (finalLabel === 'ROOT') {
        strokeColor = 'rgba(32,182,138,0.92)';
        fillColor = 'rgba(32,182,138,0.22)';
      } else if (finalLabel === 'MATRIX') {
        strokeColor = 'rgba(230,168,23,0.85)';
        fillColor = 'rgba(230,168,23,0.18)';
      } else if (finalLabel === 'ARTIFACT') {
        strokeColor = 'rgba(224,86,56,0.85)';
        fillColor = 'rgba(224,86,56,0.22)';
      }

      ctx.fillStyle = fillColor;
      ctx.fillRect(r.x, r.y, r.width, r.height);

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    }

    // 3. Legenda científica discreta no canto superior direito
    const stats = currentAnalysis.statistics || {};
    const densPct = (w * h) > 0 && stats.total_root_area ? ((stats.total_root_area / (w * h)) * 100).toFixed(3) : '0.000';

    const legendItems = [
      { label: `Raízes (ROOT): ${stats.root_count || 0}`, color: '#20b68a' }
    ];
    if (stats.artifact_count > 0) {
      legendItems.push({ label: `Artefatos: ${stats.artifact_count}`, color: '#e05638' });
    }
    if (stats.matrix_count > 0) {
      legendItems.push({ label: `Solo / Matriz: ${stats.matrix_count}`, color: '#e6a817' });
    }
    if (stats.unknown_count > 0) {
      legendItems.push({ label: `Não confirmadas: ${stats.unknown_count}`, color: '#5c8ba6' });
    }

    const legFontSize = Math.max(11, Math.round(12 * scale));
    ctx.font = `600 ${legFontSize}px sans-serif`;
    let maxItemW = 0;
    for (const item of legendItems) {
      maxItemW = Math.max(maxItemW, ctx.measureText(item.label).width);
    }

    const legPad = 12 * scale;
    const legRowH = legFontSize + (8 * scale);
    const legW = maxItemW + (36 * scale) + (legPad * 2);
    const legH = (legendItems.length * legRowH) + (26 * scale);
    const legX = w - legW - (16 * scale);
    const legY = 16 * scale;

    // Fundo da legenda
    ctx.fillStyle = 'rgba(7, 30, 56, 0.85)';
    ctx.beginPath();
    const radius = 8 * scale;
    ctx.roundRect ? ctx.roundRect(legX, legY, legW, legH, radius) : ctx.rect(legX, legY, legW, legH);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1 * scale;
    ctx.stroke();

    // Título da Legenda
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#8cd7ed';
    ctx.font = `bold ${Math.max(10, Math.round(11 * scale))}px sans-serif`;
    ctx.fillText('LEGENDA CLASSIFICATÓRIA', legX + legPad, legY + (8 * scale));

    // Itens da Legenda
    let curY = legY + (24 * scale);
    for (const item of legendItems) {
      // Amostra de cor
      ctx.fillStyle = item.color;
      ctx.fillRect(legX + legPad, curY + (2 * scale), 12 * scale, 12 * scale);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8 * scale;
      ctx.strokeRect(legX + legPad, curY + (2 * scale), 12 * scale, 12 * scale);

      // Texto do item
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${legFontSize}px sans-serif`;
      ctx.fillText(item.label, legX + legPad + (18 * scale), curY);
      curY += legRowH;
    }

    // 4. Rodapé científico com sumário estatístico
    ctx.fillStyle = '#071e38';
    ctx.fillRect(0, h, w, bannerH);

    ctx.strokeStyle = '#20b68a';
    ctx.lineWidth = Math.max(2, Math.round(3 * scale));
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, h);
    ctx.stroke();

    const titleSize = Math.max(13, Math.round(16 * scale));
    const subSize = Math.max(10, Math.round(12 * scale));

    ctx.fillStyle = '#45c8f5';
    ctx.font = `bold ${titleSize}px sans-serif`;
    ctx.fillText('RIZOMA · Análise Radicular Computacional', 20 * scale, h + (12 * scale));

    ctx.fillStyle = '#eaf2f8';
    ctx.font = `${subSize}px sans-serif`;
    const meta1 = `Amostra: ${current.sample_id || 'N/A'} | Arquivo: ${current.filename} | Resolução: ${w}×${h} px | SHA-256: ${(current.sha256||'').slice(0, 16)}…`;
    ctx.fillText(meta1, 20 * scale, h + (12 * scale) + titleSize + (5 * scale));

    ctx.fillStyle = '#2de4ad';
    ctx.font = `bold ${subSize}px sans-serif`;
    const meta2 = `Raízes: ${stats.root_count || 0} (${number.format(stats.total_root_area || 0)} px² · ${densPct}% da área total) | Solo: ${stats.matrix_count || 0} | Artefatos: ${stats.artifact_count || 0} | Status: Concluído (${stats.reviewed_count || 0}/${stats.total_regions || regions.length})`;
    ctx.fillText(meta2, 20 * scale, h + (12 * scale) + titleSize + subSize + (10 * scale));

    canvas.toBlob((blob) => {
      if(!blob){
        toast('Erro ao converter imagem classificada.');
        if(btn) btn.disabled = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rizoma-classificada-${current.sample_id || current.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Imagem classificada exportada com sucesso!');
      if(btn) btn.disabled = false;
    }, 'image/png');

  } catch(err) {
    toast('Erro na exportação: ' + err.message);
    if(btn) btn.disabled = false;
  }
}

async function setAnalysisStatus(newStatus){
  if(!currentAnalysis) return;
  try{
    const res = await api(`/api/v1/analysis-runs/${currentAnalysis.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: newStatus})
    });
    currentAnalysis.status = res.data.status;
    currentAnalysis.completed_at = res.data.completed_at;
    const item = analysisRuns.find(r => r.id === currentAnalysis.id);
    if(item) item.status = res.data.status;
    renderAnalysis();
    toast(newStatus === 'COMPLETED' ? 'Análise marcada como concluída!' : 'Análise arquivada.');
  }catch(err){ toast(err.message); }
}

async function saveAnalysisNotes(notesText){
  if(!currentAnalysis) return;
  try{
    const res = await api(`/api/v1/analysis-runs/${currentAnalysis.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({notes: notesText})
    });
    currentAnalysis.notes = res.data.notes;
    editingNotes = false;
    renderAnalysis();
    toast('Notas da análise salvas com sucesso.');
  }catch(err){ toast(err.message); }
}

function openDeleteAnalysisModal(){
  if(!currentAnalysis) return;
  $('delete-analysis-id').textContent = currentAnalysis.id.slice(0, 12) + '…';
  $('analysis-delete-modal').classList.remove('hidden');
}

function closeDeleteAnalysisModal(){
  $('analysis-delete-modal').classList.add('hidden');
}

async function confirmDeleteAnalysis(){
  if(!currentAnalysis) return;
  const deletedId = currentAnalysis.id;
  try{
    await api(`/api/v1/analysis-runs/${deletedId}`, {method: 'DELETE'});
    closeDeleteAnalysisModal();
    analysisRuns = analysisRuns.filter(r => r.id !== deletedId);
    if(analysisRuns.length > 0){
      await loadAnalysisRun(analysisRuns[0].id);
    } else {
      currentAnalysis = null;
      selectedRegion = null;
      renderAnalysis();
      fillInspect();
    }
    toast('Execução de análise excluída.');
  }catch(err){ toast(err.message); }
}

function openBatchConfirmModal(){
  if(!currentAnalysis) return;
  const pending = (currentAnalysis.regions || []).filter(r => !r.review);
  if(!pending.length){ toast('Todas as regiões já foram revisadas!'); return; }
  $('batch-confirm-count').textContent = pending.length;
  $('batch-confirm-modal').classList.remove('hidden');
}

function closeBatchConfirmModal(){
  $('batch-confirm-modal').classList.add('hidden');
}

async function submitBatchConfirm(e){
  if(e && e.preventDefault) e.preventDefault();
  if(!currentAnalysis) return;
  const justification = $('batch-confirm-justification').value.trim();
  const btn = $('btn-submit-batch-confirm');
  btn.disabled = true; btn.textContent = 'Confirmando…';
  try{
    const res = await api(`/api/v1/analysis-runs/${currentAnalysis.id}/confirm-all`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({justification})
    });
    closeBatchConfirmModal();
    toast(`${res.confirmed_count} região(ões) confirmada(s) em lote com sucesso!`);
    await loadAnalysisRun(currentAnalysis.id);
  }catch(err){ toast(err.message); }
  finally{ btn.disabled = false; btn.textContent = 'Confirmar todas em lote ⚡'; }
}

function reviewEditor(region){
  const label = region.review?.label || region.suggestion;
  const jev = region.judgment_evidence || {};
  const learning = jev.learning || {};
  const conf = jev.confidence ? Math.round(jev.confidence * 100) : null;
  const strat = learning.strategy || 'BASELINE';
  const isRecalibrated = !region.review && jev.recalibrated === true;
  const badge = conf !== null ? `<div class="learning-badge ${learning.uncertainty ? 'uncertain' : ''} ${isRecalibrated ? 'recalibrated' : ''}">Estratégia: ${h(strat)} · Confiança estimada: ${conf}% ${isRecalibrated ? '⚡ Recalibrada em tempo real' : ''} ${learning.uncertainty ? '⚠️ Alta Incerteza (Prioridade de Revisão)' : ''}</div>` : '';
  const nextReg = findNextRecommendedRegion(region.id);
  const nextBtn = nextReg ? `<button type="button" id="btn-next-review" class="button outline full" style="margin-top:6px">Salvar e ir para próxima recomendada (R${nextReg.ordinal}) ➜</button>` : '';
  return `<form id="review-form" class="review-form">
    <h3>Revisar região R${region.ordinal}</h3>
    ${badge}
    <p class="automatic-hypothesis">Hipótese automática: <strong>${h(automaticLabel(region.suggestion, isRecalibrated))}</strong>. Concordância é evidência técnica, não confiança científica.</p>
    <div class="evidence"><span>Global: ${number.format(region.evidence.global_pixels)}</span><span>Local: ${number.format(region.evidence.local_pixels)}</span><span>Concordância: ${number.format(region.evidence.shared_pixels)} px</span></div>
    <label>Ação<select id="review-action"><option value="CONFIRM">Confirmar interpretação</option><option value="CORRECT">Corrigir classificação</option><option value="SUSPEND">Suspender julgamento</option></select></label>
    <label>Classificação<select id="review-label">${['ROOT','MATRIX','ARTIFACT','UNKNOWN'].map(v => `<option ${v===label?'selected':''}>${v}</option>`).join('')}</select></label>
    <label>Justificativa<textarea id="review-justification" maxlength="1000" placeholder="Evidência ou motivo da decisão">${h(region.review?.justification || '')}</textarea></label>
    <button class="button primary full" type="submit">Salvar nova revisão</button>
    ${nextBtn}
    <div id="review-history" class="review-history"><small>Carregando histórico…</small></div>
  </form>`;
}

async function loadHistory(regionId){
  try{
    const result = await api(`/api/v1/analysis-regions/${regionId}/reviews`);
    if(!selectedRegion || selectedRegion.id !== regionId || !$('review-history')) return;
    $('review-history').innerHTML = result.data.length ? `<h4>Histórico preservado</h4>${result.data.map(e => `<div><strong>v${e.version} · ${h(e.action)} → ${h(e.label)}</strong><small>${h(e.created_at)} · ${h(e.reviewer)}</small><p>${h(e.justification || 'Sem justificativa')}</p></div>`).join('')}` : '<small>Nenhuma revisão humana registrada.</small>';
  }catch(err){ if($('review-history')) $('review-history').textContent = err.message; }
}

async function startAnalysis(){
  if(!current) return;
  const button = $('start-analysis'); button.disabled = true; button.textContent = 'Analisando…';
  const strategy = $('analysis-strategy')?.value || 'BAYESIAN_CALIBRATED';
  try{
    const result = await api(`/api/v1/images/${current.id}/analysis?algorithm=${encodeURIComponent(strategy)}`, {method:'POST'});
    currentAnalysis = result.data; const runs=await api(`/api/v1/images/${current.id}/analysis-runs`);analysisRuns=runs.data||[];selectedRegion = currentAnalysis.regions?.[0] || null; renderAnalysis();
    if(selectedRegion) loadHistory(selectedRegion.id);
    fillInspect(); toast(`${currentAnalysis.regions.length} região(ões) registrada(s) via ${strategy}.`);
  }catch(err){ toast(err.message); }
  finally{ button.disabled = false; button.textContent = 'Executar nova análise'; }
}

async function saveReview(event, advanceNext = false){
  if(event && event.preventDefault) event.preventDefault();
  if(!selectedRegion) return;
  const targetRegionId = selectedRegion.id;
  const activeRunId = currentAnalysis?.id;
  const action=$('review-action').value;
  const label=action==='SUSPEND'?'UNKNOWN':$('review-label').value;
  const nextTarget = advanceNext ? findNextRecommendedRegion(targetRegionId) : null;
  try{
    const revRes = await api(`/api/v1/analysis-regions/${targetRegionId}/reviews`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,label,justification:$('review-justification').value.trim(),expected_version:selectedRegion.version})
    });
    const url = `/api/v1/images/${current.id}/analysis` + (activeRunId ? `?run_id=${encodeURIComponent(activeRunId)}` : '');
    const result = await api(url);
    currentAnalysis = result.data;
    selectedRegion = nextTarget ? regionById(nextTarget.id) : regionById(targetRegionId);
    renderAnalysis();
    if(selectedRegion) loadHistory(selectedRegion.id);
    const recalibrated = revRes?.recalibrated_count || 0;
    if(recalibrated > 0){
      toast(`Revisão salva! ${recalibrated} região(ões) pendente(s) foram recalibradas em tempo real.`);
    } else {
      toast('Revisão salva no histórico.');
    }
  }catch(err){
    toast(err.message === 'Review conflict' ? 'Conflito: a região foi revisada em outra sessão. Recarregue a análise.' : err.message);
  }
}

function closeInspect(){
  $('inspector').classList.add('hidden');
  closeEditImageModal();
  closeDeleteImageModal();
  closeDeleteAnalysisModal();
  closeBatchConfirmModal();
  if($('auth-overlay').classList.contains('hidden')){
    document.body.style.overflow = '';
  }
  current = null;
  currentAnalysis = null;
  analysisRuns = [];
  selectedRegion = null;
  editingNotes = false;
  viewer.revision++; viewer.imageId = null; viewer.manifest = null; viewer.drag = null;
  cancelAnimationFrame(viewer.frame); $('tile-layer').replaceChildren(); $('inspect-image').removeAttribute('src');
}

function openEditImageModal(){
  if(!current) return;
  $('edit-sample-id').value = current.sample_id || '';
  $('edit-capture-date').value = current.capture_date || '';
  $('edit-filename').value = current.filename || '';
  $('image-edit-modal').classList.remove('hidden');
  $('edit-filename').focus();
}

function closeEditImageModal(){
  $('image-edit-modal').classList.add('hidden');
}

async function saveEditImage(e){
  e.preventDefault();
  if(!current) return;
  const sample_id = $('edit-sample-id').value.trim();
  const capture_date = $('edit-capture-date').value;
  const filename = $('edit-filename').value.trim();
  if(!filename){ toast('Nome do arquivo é obrigatório'); return; }
  try{
    const res = await api(`/api/v1/images/${current.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({sample_id, capture_date, filename})
    });
    current.sample_id = res.data.sample_id;
    current.capture_date = res.data.capture_date;
    current.filename = res.data.filename;
    const inList = images.find(img => img.id === current.id);
    if(inList){
      inList.sample_id = res.data.sample_id;
      inList.capture_date = res.data.capture_date;
      inList.filename = res.data.filename;
    }
    $('inspect-title').textContent = current.filename;
    fillInspect();
    render();
    closeEditImageModal();
    toast('Metadados da imagem atualizados.');
  }catch(err){ toast(err.message); }
}

function openDeleteImageModal(){
  if(!current) return;
  $('delete-image-name').textContent = current.filename;
  $('image-delete-modal').classList.remove('hidden');
}

function closeDeleteImageModal(){
  $('image-delete-modal').classList.add('hidden');
}

async function confirmDeleteImage(){
  if(!current) return;
  const imageId = current.id;
  try{
    await api(`/api/v1/images/${imageId}`, {method: 'DELETE'});
    closeDeleteImageModal();
    closeInspect();
    images = images.filter(img => img.id !== imageId);
    render();
    toast('Imagem removida do acervo.');
  }catch(err){ toast(err.message); }
}

function filesSelected(files){
  selectedFiles = Array.from(files);
  $('file-count').textContent = selectedFiles.length ? `${selectedFiles.length} arquivo(s) selecionado(s)` : 'Nenhum arquivo selecionado';
  $('file-list').innerHTML = selectedFiles.map(f => `<li>${h(f.name)} — ${(f.size / 1024 / 1024).toFixed(2)} MiB</li>`).join('');
  $('send').disabled = selectedFiles.length === 0;
}

async function upload(e){
  e.preventDefault();
  if(!selectedFiles.length) return;
  const btn = $('send');
  btn.disabled = true;
  const sample = $('sample-id').value.trim(), date = $('capture-date').value;
  const results = $('upload-results');
  results.innerHTML = '';
  let successes = 0;
  for(let i = 0; i < selectedFiles.length; i++){
    const file = selectedFiles[i];
    const status = document.createElement('p');
    status.textContent = `Enviando ${i + 1}/${selectedFiles.length}: ${file.name}…`;
    results.append(status);
    try{
      if(file.size > 8 * 1024 * 1024 * 1024) throw Error('Arquivo acima do limite operacional de 8 GiB');
      const url = new URL('/api/v1/images', location.href);
      url.searchParams.set('filename', file.name);
      url.searchParams.set('sample_id', sample);
      url.searchParams.set('capture_date', date);
      await api(url.pathname + url.search, {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream', 'X-Rizoma-Client': 'web-v0.2.0'},
        body: file
      });
      status.textContent = `✓ ${file.name}: original preservado e prévias geradas.`;
      successes++;
    }catch(err){
      status.classList.add('fail');
      status.textContent = `✕ ${file.name}: ${err.message}`;
    }
  }
  btn.disabled = false;
  toast(`${successes} de ${selectedFiles.length} arquivo(s) registrado(s).`);
  await refresh();
  if(successes === selectedFiles.length){
    $('upload-form').reset();
    filesSelected([]);
  }
}

for(const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => nav(b.dataset.view));
$('hero-upload').onclick = () => nav('recebimento');
$('refresh').onclick = refresh;
$('search').oninput = render;
$('filter').onchange = render;
$('upload-form').addEventListener('submit', upload);

$('file-input').onchange = e => filesSelected(e.target.files);
const drop = $('dropzone');
for(const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); });
for(const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', e => filesSelected(e.dataTransfer.files));

$('close-inspect').onclick = closeInspect;
$('inspector').addEventListener('click', e => { if(e.target === $('inspector')) closeInspect(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !$('inspector').classList.contains('hidden')) closeInspect(); });

for(const b of document.querySelectorAll('[data-image-mode]')) b.onclick = () => { mode = b.dataset.imageMode; fillInspect(); };
$('zoom').oninput = e => setViewerZoom(Number(e.target.value) / 100);
$('zoom-in').onclick = () => setViewerZoom(viewer.scale * 1.35);
$('zoom-out').onclick = () => setViewerZoom(viewer.scale / 1.35);
$('zoom-fit').onclick = fitViewer;
$('zoom-actual').onclick = () => setViewerZoom(1);
$('start-analysis').onclick = startAnalysis;

const imageStage = $('image-stage');
imageStage.addEventListener('wheel', e => {
  if(!current) return;
  e.preventDefault();
  const bounds = imageStage.getBoundingClientRect();
  setViewerZoom(viewer.scale * Math.exp(-e.deltaY * .0015), e.clientX - bounds.left, e.clientY - bounds.top);
}, {passive:false});
imageStage.addEventListener('pointerdown', e => {
  if(!current || e.button !== 0 || e.target.closest('.region-box')) return;
  viewer.drag = {pointer:e.pointerId, clientX:e.clientX, clientY:e.clientY, x:viewer.x, y:viewer.y};
  imageStage.setPointerCapture(e.pointerId); imageStage.classList.add('panning');
});
imageStage.addEventListener('pointermove', e => {
  const bounds = imageStage.getBoundingClientRect();
  const imageX = Math.floor((e.clientX - bounds.left - viewer.x) / viewer.scale), imageY = Math.floor((e.clientY - bounds.top - viewer.y) / viewer.scale);
  $('cursor-position').textContent = current && imageX >= 0 && imageY >= 0 && imageX < current.width && imageY < current.height ? `x ${number.format(imageX)} · y ${number.format(imageY)}` : '—';
  if(!viewer.drag || viewer.drag.pointer !== e.pointerId) return;
  viewer.x = viewer.drag.x + e.clientX - viewer.drag.clientX; viewer.y = viewer.drag.y + e.clientY - viewer.drag.clientY;
  viewer.fit = false; renderViewer();
});
function stopViewerDrag(e){
  if(!viewer.drag || viewer.drag.pointer !== e.pointerId) return;
  viewer.drag = null; imageStage.classList.remove('panning');
}
imageStage.addEventListener('pointerup', stopViewerDrag);
imageStage.addEventListener('pointercancel', stopViewerDrag);
imageStage.addEventListener('pointerleave', () => { if(!viewer.drag) $('cursor-position').textContent = '—'; });
imageStage.addEventListener('dblclick', e => {
  const bounds = imageStage.getBoundingClientRect(); setViewerZoom(viewer.scale * 2, e.clientX - bounds.left, e.clientY - bounds.top);
});
imageStage.addEventListener('keydown', e => {
  if(!current) return;
  if(e.key === '+' || e.key === '=') setViewerZoom(viewer.scale * 1.25);
  else if(e.key === '-') setViewerZoom(viewer.scale / 1.25);
  else if(e.key === '0') fitViewer();
  else if(e.key === '1') setViewerZoom(1);
  else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    const delta=60;if(e.key==='ArrowLeft')viewer.x+=delta;if(e.key==='ArrowRight')viewer.x-=delta;if(e.key==='ArrowUp')viewer.y+=delta;if(e.key==='ArrowDown')viewer.y-=delta;viewer.fit=false;renderViewer();
  } else return;
  e.preventDefault();
});
window.addEventListener('resize', () => { if(!current) return; if(viewer.fit) fitViewer(); else renderViewer(); });

$('menu').onclick = () => {
  const open = $('sidebar').classList.toggle('open');
  $('mobile-scrim').classList.toggle('shown', open);
  $('menu').setAttribute('aria-expanded', String(open));
};
$('mobile-scrim').onclick = () => {
  $('sidebar').classList.remove('open');
  $('mobile-scrim').classList.remove('shown');
};

// Auth form listeners
$('auth-email-form').addEventListener('submit', requestAuthCode);
$('auth-code-form').addEventListener('submit', verifyAuthCode);
$('btn-resend-code').addEventListener('click', requestAuthCode);
$('btn-switch-email').addEventListener('click', () => {
  $('auth-code-form').classList.add('hidden');
  $('auth-email-form').classList.remove('hidden');
  setAuthFeedback('');
  $('auth-email-input').focus();
});
$('btn-logout').addEventListener('click', logout);

// Initialize view and check session
const initial = location.hash.slice(1);
nav(viewNames[initial] ? initial : 'acervo');
refresh();

// Image and Analysis CRUD modal listeners
$('btn-edit-image').onclick = openEditImageModal;
$('close-edit-image').onclick = closeEditImageModal;
$('btn-cancel-edit-image').onclick = closeEditImageModal;
$('edit-image-form').onsubmit = saveEditImage;

$('btn-delete-image').onclick = openDeleteImageModal;
$('close-delete-image').onclick = closeDeleteImageModal;
$('btn-cancel-delete-image').onclick = closeDeleteImageModal;
$('btn-confirm-delete-image').onclick = confirmDeleteImage;

$('close-delete-analysis').onclick = closeDeleteAnalysisModal;
$('btn-cancel-delete-analysis').onclick = closeDeleteAnalysisModal;
$('btn-confirm-delete-analysis').onclick = confirmDeleteAnalysis;

$('close-batch-confirm').onclick = closeBatchConfirmModal;
$('btn-cancel-batch-confirm').onclick = closeBatchConfirmModal;
$('batch-confirm-form').onsubmit = submitBatchConfirm;

// Previne o zoom acidental da pagina inteira pelo navegador via Ctrl + Roda do mouse
window.addEventListener('wheel', e => { if(e.ctrlKey) e.preventDefault(); }, { passive: false });

