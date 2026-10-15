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
let images = [], selectedFiles = [], current = null, mode = 'original', currentUser = null;
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

function applyZoom(){
  const z = Number($('zoom').value) || 100;
  $('zoomvalue').textContent = z + '%';
  const img = $('inspect-image');
  if(!img) return;
  if(z === 100){
    img.style.maxWidth = '100%';
    img.style.maxHeight = '46vh';
    img.style.width = 'auto';
    img.style.height = 'auto';
  } else {
    const stage = img.parentElement;
    const stageW = Math.max(240, (stage ? stage.clientWidth : 600) - 48);
    const stageH = Math.max(200, (stage ? stage.clientHeight : 350) - 48);
    const aspect = (current && current.width && current.height) ? (current.width / current.height) : (img.naturalWidth ? img.naturalWidth / img.naturalHeight : 1);
    let baseW = stageW;
    if(baseW / aspect > stageH) baseW = stageH * aspect;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = Math.round(baseW * (z / 100)) + 'px';
    img.style.height = 'auto';
  }
}

function openInspect(id){
  current = images.find(x => x.id === id);
  if(!current) return;
  mode = 'original';
  $('inspect-title').textContent = current.filename;
  $('inspector').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('zoom').value = '100';
  fillInspect();
  $('close-inspect').focus();
}

function fillInspect(){
  if(!current) return;
  for(const b of document.querySelectorAll('[data-image-mode]'))
    b.classList.toggle('active', b.dataset.imageMode === mode);
  const src = mode === 'original'
    ? `/api/v1/images/${current.id}/original-view`
    : `/api/v1/images/${current.id}/${mode}`;
  const img = $('inspect-image');
  img.src = src;
  applyZoom();
  $('inspect-metadata').innerHTML = [
    ['Identificador', current.id],
    ['Amostra', current.sample_id || 'Não informada'],
    ['Captura', current.capture_date || 'Não informada'],
    ['Dimensões', `${number.format(current.width)} × ${number.format(current.height)} px`],
    ['Formato', current.format.toUpperCase()],
    ['Tamanho', `${(current.bytes / 1024 / 1024).toFixed(2)} MiB`],
    ['Responsável', current.user_email || 'Não registrado'],
    ['Preparação', current.pipeline],
    ['Estado científico', 'NÃO ANALISADA'],
    ['SHA-256', current.sha256],
    ['Arquivo Original', `<a href="/api/v1/images/${current.id}/original" download="${h(current.filename)}" class="open-link" style="display:inline-flex;align-items:center;gap:4px">Baixar arquivo original (${current.format.toUpperCase()}) ↗</a>`]
  ].map(([label, value], i) => `<div class="${i >= 9 ? 'hash' : ''}"><dt>${h(label)}</dt><dd>${value}</dd></div>`).join('');
}

function closeInspect(){
  $('inspector').classList.add('hidden');
  if($('auth-overlay').classList.contains('hidden')){
    document.body.style.overflow = '';
  }
  current = null;
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
      if(file.size > 12 * 1024 * 1024) throw Error('Arquivo acima de 12 MiB');
      const url = new URL('/api/v1/images', location.href);
      url.searchParams.set('filename', file.name);
      url.searchParams.set('sample_id', sample);
      url.searchParams.set('capture_date', date);
      const body = await file.arrayBuffer();
      await api(url.pathname + url.search, {
        method: 'POST',
        headers: {'Content-Type': 'application/octet-stream', 'X-Rizoma-Client': 'web-v0.2.0'},
        body
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
$('zoom').oninput = applyZoom;
$('inspect-image').onload = applyZoom;

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

