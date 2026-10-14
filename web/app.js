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
let images = [], selectedFiles = [], current = null, mode = 'original';
const viewNames = {acervo:'Acervo de imagens',recebimento:'Recebimento',integridade:'Integridade e origem',sobre:'Sobre o RIZOMA'};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),4400);}
function nav(view){for(const name of Object.keys(viewNames)){$('view-'+name).classList.toggle('hidden',view!==name);}for(const b of document.querySelectorAll('[data-view]')){let active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}$('page-name').textContent=viewNames[view];$('sidebar').classList.remove('open');$('mobile-scrim').classList.remove('shown');$('menu').setAttribute('aria-expanded','false');location.hash=view;window.scrollTo(0,0);}
async function api(path,options={}){const r=await fetch(path,options);let data=await r.json().catch(()=>({error:'Resposta inválida do servidor'}));if(!r.ok)throw Error(data.error||`Erro HTTP ${r.status}`);return data;}
function render(){const search=$('search').value.trim().toLowerCase(),filter=$('filter').value;let items=images.filter(x=>(filter==='all'||filter===x.qc_state)&&(!search||[x.filename,x.sample_id,x.sha256,x.id].join(' ').toLowerCase().includes(search)));
$('stat-total').textContent=number.format(images.length);$('stat-prepared').textContent=number.format(images.length);$('stat-review').textContent=number.format(images.filter(i=>i.qc_state!=='REVIEW').length);
if(!items.length){$('gallery').innerHTML=`<div class="empty"><svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="8" width="42" height="36" rx="5"/><path d="m10 37 12-13 8 7 6-10 10 16"/><circle cx="16" cy="18" r="3"/></svg><h3>${images.length?'Nenhuma imagem corresponde aos filtros':'Seu acervo começa com uma imagem'}</h3><p>${images.length?'Experimente outra pesquisa ou limpe os filtros.':'Envie os primeiros registros para preservar originais e gerar prévias para inspeção.'}</p>${images.length?'':'<button class="button primary" id="empty-upload">Receber primeira imagem →</button>'}</div>`;if($('empty-upload'))$('empty-upload').onclick=()=>nav('recebimento');return;}
$('gallery').innerHTML=items.map(x=>`<button class="image-card" type="button" data-image="${h(x.id)}" aria-label="Inspecionar ${h(x.filename)}"><div class="thumb"><img src="/api/v1/images/${h(x.id)}/preview" alt="" loading="lazy"><span class="thumb-tag">${number.format(x.width)} × ${number.format(x.height)}</span></div><div class="cardbody"><strong title="${h(x.filename)}">${h(x.filename)}</strong><p>${h(x.sample_id||'Sem amostra')} · ${h(x.capture_date||x.created_at.slice(0,10))}</p><div class="card-foot"><span class="quality ${x.qc_state==='REVIEW'?'':'alert'}">${x.qc_state==='REVIEW'?'Inspeção visual':x.qc_state==='LOW_LIGHT'?'Pouca luz':'Excesso de luz'}</span><span class="open-link">Abrir ↗</span></div></div></button>`).join('');for(const item of document.querySelectorAll('[data-image]'))item.onclick=()=>openInspect(item.dataset.image);
}
async function refresh(){try{const res=await api('/api/v1/images');images=res.data||[];render();$('service-state').textContent='Serviço local ativo';$('service-state').parentElement.classList.remove('offline');}catch(e){$('service-state').textContent='Servidor indisponível';$('service-state').parentElement.classList.add('offline');$('gallery').innerHTML=`<div class="empty"><h3>Não foi possível consultar o servidor</h3><p>${h(e.message)}. Confira se o RIZOMA está em execução.</p></div>`;}}
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
    if(baseW / aspect > stageH){
      baseW = stageH * aspect;
    }
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
    ['Preparação', current.pipeline],
    ['Estado científico', 'NÃO ANALISADA'],
    ['SHA-256', current.sha256],
    ['Arquivo Original', `<a href="/api/v1/images/${current.id}/original" download="${h(current.filename)}" class="open-link" style="display:inline-flex;align-items:center;gap:4px">Baixar arquivo original (${current.format.toUpperCase()}) ↗</a>`]
  ].map(([label, value], i) => `<div class="${i >= 8 ? 'hash' : ''}"><dt>${h(label)}</dt><dd>${value}</dd></div>`).join('');
}
function closeInspect(){$('inspector').classList.add('hidden');document.body.style.overflow='';current=null;}
function filesSelected(files){selectedFiles=Array.from(files);$('file-count').textContent=selectedFiles.length?`${selectedFiles.length} arquivo(s) selecionado(s)`:'Nenhum arquivo selecionado';$('file-list').innerHTML=selectedFiles.map(f=>`<li>${h(f.name)} — ${(f.size/1024/1024).toFixed(2)} MiB</li>`).join('');$('send').disabled=selectedFiles.length===0;}
async function upload(e){e.preventDefault();if(!selectedFiles.length)return;const btn=$('send');btn.disabled=true;const sample=$('sample-id').value.trim(),date=$('capture-date').value;const results=$('upload-results');results.innerHTML='';let successes=0;for(let i=0;i<selectedFiles.length;i++){const file=selectedFiles[i];const status=document.createElement('p');status.textContent=`Enviando ${i+1}/${selectedFiles.length}: ${file.name}…`;results.append(status);try{if(file.size>12*1024*1024)throw Error('Arquivo acima de 12 MiB');const url=new URL('/api/v1/images',location.href);url.searchParams.set('filename',file.name);url.searchParams.set('sample_id',sample);url.searchParams.set('capture_date',date);const body=await file.arrayBuffer();await api(url.pathname+url.search,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Rizoma-Client':'web-v0.2.0'},body});status.textContent=`✓ ${file.name}: original preservado e prévias geradas.`;successes++;}catch(e){status.classList.add('fail');status.textContent=`✕ ${file.name}: ${e.message}`;}}
btn.disabled=false;toast(`${successes} de ${selectedFiles.length} arquivo(s) registrado(s).`);await refresh();if(successes===selectedFiles.length){$('upload-form').reset();filesSelected([]);}}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>nav(b.dataset.view));
$('hero-upload').onclick=()=>nav('recebimento');$('refresh').onclick=refresh;$('search').oninput=render;$('filter').onchange=render;$('upload-form').addEventListener('submit',upload);
$('file-input').onchange=e=>filesSelected(e.target.files);const drop=$('dropzone');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('drag');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('drag');});drop.addEventListener('drop',e=>filesSelected(e.dataTransfer.files));
$('close-inspect').onclick=closeInspect;$('inspector').addEventListener('click',e=>{if(e.target===$('inspector'))closeInspect();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('inspector').classList.contains('hidden'))closeInspect();});
for(const b of document.querySelectorAll('[data-image-mode]'))b.onclick=()=>{mode=b.dataset.imageMode;fillInspect();};
$('zoom').oninput=applyZoom;
$('inspect-image').onload=applyZoom;

$('menu').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('mobile-scrim').classList.toggle('shown',open);$('menu').setAttribute('aria-expanded',String(open));};$('mobile-scrim').onclick=()=>{$('sidebar').classList.remove('open');$('mobile-scrim').classList.remove('shown');};
const initial=location.hash.slice(1);nav(viewNames[initial]?initial:'acervo');refresh();
