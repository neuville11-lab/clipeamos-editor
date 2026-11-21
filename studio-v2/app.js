const $ = (id) => document.getElementById(id);
const keys = { brief: 'cliplab_studio_brief_v2', api: 'cliplab_studio_api_v2', projects: 'cliplab_studio_projects_v2', campaigns: 'cliplab_studio_campaigns_v2', prefs: 'cliplab_studio_prefs_v2' };
const readStore = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = { file: null, videoUrl: null, api: localStorage.getItem(keys.api) || '', job: null, pollTimer: null, view: 'editor', projectId: null, projects: Array.isArray(readStore(keys.projects, [])) ? readStore(keys.projects, []) : [], campaigns: Array.isArray(readStore(keys.campaigns, [])) ? readStore(keys.campaigns, []) : [], assets: [], prefs: readStore(keys.prefs, { model: 'base', language: 'es', diarization: false, denoise: false, music: true }) };

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function formatSize(bytes) {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

const viewInfo = {
  editor: ['Nuevo proyecto', 'Tu próximo clip empieza aquí.'],
  projects: ['Proyectos', 'Tus borradores y trabajos recientes.'],
  library: ['Biblioteca', 'Archivos disponibles en esta sesión.'],
  campaigns: ['Campañas', 'Briefs y requisitos guardados en este navegador.'],
  settings: ['Ajustes', 'Configura el backend y las preferencias de ClipLab.'],
};

function switchView(view) {
  state.view = viewInfo[view] ? view : 'editor';
  $('editorView').hidden = state.view !== 'editor';
  $('sectionView').hidden = state.view === 'editor';
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  document.querySelector('.breadcrumbs b').textContent = viewInfo[state.view][0];
  if (state.view === 'editor') return;
  renderSection();
}

function renderSection() {
  const host = $('sectionView');
  const commonHead = (eyebrow, title, description, action = '') => `<section class="page-heading section-heading"><div><div class="overline"><span class="overline-dot"></span> ${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</section>`;
  if (state.view === 'projects') {
    host.innerHTML = `${commonHead('TU ESPACIO DE TRABAJO','Proyectos','Continúa un borrador o crea un proyecto nuevo. Los vídeos no se guardan localmente al cerrar la página.', '<button class="primary-button" id="sectionNewProject">＋ Nuevo proyecto</button>')}<div class="section-toolbar"><span id="projectSummary"></span><select id="projectFilter" class="section-select" aria-label="Filtrar proyectos"><option value="all">Todos los proyectos</option><option value="draft">Borradores</option></select></div><div class="entity-grid" id="projectsGrid"></div>`;
    $('sectionNewProject').addEventListener('click', () => { resetProject(); switchView('editor'); });
    $('projectFilter').addEventListener('change', renderProjects);
    renderProjects();
  } else if (state.view === 'campaigns') {
    host.innerHTML = `${commonHead('REGLAS DE PUBLICACIÓN','Campañas','Guarda briefs, duración mínima, menciones y requisitos para reutilizarlos.', '<button class="primary-button" id="campaignNewButton">＋ Nueva campaña</button>')}<section class="card section-form-card" id="campaignFormCard"><div class="section-form-head"><div><h2>Nueva campaña</h2><p>El texto del brief se guarda solo en este navegador.</p></div><button class="quiet-button" id="cancelCampaignForm">Cancelar</button></div><div class="section-form-grid"><label class="field-label">Nombre de la campaña<input id="campaignInputName" class="section-input" placeholder="Ej. Campaña Reental"></label><label class="field-label">Red social<select id="campaignInputPlatform" class="section-input"><option>TikTok</option><option>Instagram Reels</option><option>YouTube Shorts</option></select></label><label class="field-label full">Brief<textarea id="campaignInputBrief" class="section-textarea" placeholder="Pega las reglas de Clipeamos aquí…"></textarea></label></div><div class="section-form-actions"><span class="privacy-note">▣ Guardado local · no se sube</span><button class="primary-button" id="saveCampaignButton">Guardar campaña</button></div></section><div class="section-toolbar"><span id="campaignSummary"></span></div><div class="entity-grid" id="campaignsGrid"></div>`;
    $('campaignNewButton').addEventListener('click', () => { $('campaignFormCard').hidden = false; $('campaignInputName').focus(); });
    $('cancelCampaignForm').addEventListener('click', () => { $('campaignFormCard').hidden = true; });
    $('saveCampaignButton').addEventListener('click', saveCampaignFromForm);
    $('campaignFormCard').hidden = true;
    renderCampaigns();
  } else if (state.view === 'library') {
    host.innerHTML = `${commonHead('TUS ARCHIVOS','Biblioteca','Añade pistas de audio y consulta los medios seleccionados en esta sesión.', '<label class="primary-button file-button">＋ Añadir archivos<input id="libraryFiles" type="file" accept="audio/*,video/*,.srt,.vtt" multiple hidden></label>')}<div class="library-notice"><span>i</span><div><b>Almacenamiento de sesión</b><p>La lista desaparece al cerrar o recargar esta pestaña. El almacenamiento persistente y privado se habilitará con el backend.</p></div></div><div class="section-toolbar"><span id="librarySummary"></span></div><div class="entity-grid" id="libraryGrid"></div>`;
    $('libraryFiles').addEventListener('change', (event) => addLibraryFiles(event.target.files));
    renderLibrary();
  } else if (state.view === 'settings') {
    host.innerHTML = `${commonHead('PREFERENCIAS','Ajustes','Elige cómo debe trabajar el motor cuando esté conectado.')}<div class="settings-grid"><section class="card settings-card"><div class="card-heading"><div class="heading-icon violet">API</div><div><h2>Backend de ClipLab</h2><p>La URL se guarda solo en este navegador. No guardes claves aquí.</p></div></div><div class="settings-content"><label class="field-label" for="settingsApiUrl">URL del servicio</label><div class="settings-inline"><input class="section-input" id="settingsApiUrl" type="url" placeholder="https://api.tu-dominio.com"><button class="secondary-button" id="settingsTestConnection">Probar conexión</button></div><div class="dialog-status" id="settingsServiceStatus"><span class="status-dot"></span> Sin conectar</div></div></section><section class="card settings-card"><div class="card-heading"><div class="heading-icon orange">AI</div><div><h2>Procesamiento de voz</h2><p>Preferencias que se enviarán al worker cuando se active.</p></div></div><div class="settings-content settings-options"><label class="field-label">Modelo de transcripción<select class="section-input" id="prefModel"><option value="base">Whisper Base · equilibrio</option><option value="small">Whisper Small · más precisión y coste</option></select></label><label class="field-label">Idioma de transcripción<select class="section-input" id="prefLanguage"><option value="es">Español</option><option value="auto">Detección automática</option><option value="en">Inglés</option></select></label><label class="toggle-row"><span><b>Identificar quién habla</b><small>Diarización de voces · necesita modelo adicional.</small></span><input type="checkbox" id="prefDiarization"></label><label class="toggle-row"><span><b>Limpiar ruido de voz</b><small>Mejora opcional de audio · añade tiempo de proceso.</small></span><input type="checkbox" id="prefDenoise"></label><label class="toggle-row"><span><b>Incluir base musical</b><small>La música se mezcla por debajo de la voz.</small></span><input type="checkbox" id="prefMusic"></label><button class="primary-button" id="savePrefs">Guardar preferencias</button></div></section><section class="card settings-card privacy-card"><div class="heading-icon dark">▣</div><div><h2>Privacidad y coste</h2><p>El procesamiento en nube enviará el vídeo al backend y a los workers configurados. La política de borrado y el límite de gasto se establecerán antes de activarlo.</p></div></section></div>`;
    $('settingsApiUrl').value = state.api;
    $('prefModel').value = state.prefs.model;
    $('prefLanguage').value = state.prefs.language;
    $('prefDiarization').checked = state.prefs.diarization;
    $('prefDenoise').checked = state.prefs.denoise;
    $('prefMusic').checked = state.prefs.music;
    $('settingsTestConnection').addEventListener('click', async () => { $('apiUrl').value = $('settingsApiUrl').value; await checkConnection(); $('settingsApiUrl').value = state.api || $('settingsApiUrl').value; const source = $('serviceStatus'); $('settingsServiceStatus').classList.toggle('connected', source.classList.contains('connected')); $('settingsServiceStatus').textContent = source.textContent; });
    $('savePrefs').addEventListener('click', savePreferences);
  }
}

function persistProjects() { localStorage.setItem(keys.projects, JSON.stringify(state.projects)); }
function persistCampaigns() { localStorage.setItem(keys.campaigns, JSON.stringify(state.campaigns)); $('campaignCount').textContent = String(state.campaigns.length); }

function saveCurrentProject(silent = false) {
  const brief = $('briefText').value.trim();
  if (!brief && !state.file) { if (!silent) toast('Añade un brief o un vídeo antes de guardar.'); return; }
  const name = $('projectNameInput').value.trim() || brief.split(/\r?\n/).find(Boolean)?.slice(0, 48) || state.file?.name || 'Proyecto sin título';
  const project = { id: state.projectId || `project-${Date.now()}`, name, brief, videoName: state.file?.name || '', updatedAt: Date.now(), status: 'Borrador' };
  state.projectId = project.id;
  state.projects = [project, ...state.projects.filter((item) => item.id !== project.id)];
  persistProjects();
  if (!silent) toast('Proyecto guardado en este navegador.');
  if (state.view === 'projects') renderProjects();
}

function resetProject() {
  state.projectId = null;
  $('projectNameInput').value = '';
  $('briefText').value = '';
  localStorage.removeItem(keys.brief);
  $('briefFile').value = '';
  resetVideo();
  renderRules();
}

function loadProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  state.projectId = project.id;
  $('projectNameInput').value = project.name || '';
  $('briefText').value = project.brief || '';
  localStorage.setItem(keys.brief, $('briefText').value);
  resetVideo();
  renderRules();
  switchView('editor');
  toast(project.videoName ? 'Borrador abierto. Vuelve a seleccionar el vídeo fuente para continuar.' : 'Borrador abierto.');
}

function renderProjects() {
  const grid = $('projectsGrid'); if (!grid) return;
  const onlyDrafts = $('projectFilter').value === 'draft';
  const projects = [...state.projects].sort((a, b) => b.updatedAt - a.updatedAt).filter((p) => !onlyDrafts || p.status === 'Borrador');
  $('projectSummary').textContent = `${projects.length} ${projects.length === 1 ? 'proyecto' : 'proyectos'}`;
  grid.replaceChildren();
  if (!projects.length) { grid.append(makeEmptyCard('Aún no hay proyectos guardados', 'Guarda el brief y los ajustes para volver a ellos más tarde.', 'Crear proyecto', () => { resetProject(); switchView('editor'); })); return; }
  projects.forEach((project) => {
    const card = document.createElement('article'); card.className = 'entity-card';
    const icon = document.createElement('div'); icon.className = 'entity-icon project-icon'; icon.textContent = '▶';
    const title = document.createElement('h3'); title.textContent = project.name;
    const detail = document.createElement('p'); detail.textContent = project.videoName ? `${project.videoName} · el archivo debe volver a seleccionarse` : (project.brief ? project.brief.slice(0, 115) : 'Sin brief');
    const meta = document.createElement('div'); meta.className = 'entity-meta'; meta.textContent = `${project.status} · ${new Date(project.updatedAt).toLocaleDateString('es-ES')}`;
    const open = document.createElement('button'); open.className = 'secondary-button'; open.textContent = 'Continuar proyecto'; open.addEventListener('click', () => loadProject(project.id));
    card.append(icon, title, detail, meta, open); grid.append(card);
  });
}

function saveCampaignFromForm() {
  const name = $('campaignInputName').value.trim();
  const brief = $('campaignInputBrief').value.trim();
  if (!name || !brief) return toast('Escribe el nombre y el brief de la campaña.');
  const platform = $('campaignInputPlatform').value;
  const campaign = { id: `campaign-${Date.now()}`, name, brief, platform, createdAt: Date.now() };
  state.campaigns = [campaign, ...state.campaigns];
  persistCampaigns();
  $('campaignInputName').value = '';
  $('campaignInputBrief').value = '';
  $('campaignFormCard').hidden = true;
  renderCampaigns();
  toast('Campaña guardada.');
}

function renderCampaigns() {
  const grid = $('campaignsGrid'); if (!grid) return;
  $('campaignSummary').textContent = `${state.campaigns.length} ${state.campaigns.length === 1 ? 'campaña guardada' : 'campañas guardadas'}`;
  grid.replaceChildren();
  if (!state.campaigns.length) { grid.append(makeEmptyCard('Aún no hay campañas', 'Guarda un brief para reutilizar sus reglas y requisitos.', 'Crear campaña', () => { $('campaignFormCard').hidden = false; })); return; }
  state.campaigns.forEach((campaign) => {
    const parsed = parseBrief(campaign.brief);
    const card = document.createElement('article'); card.className = 'entity-card';
    const icon = document.createElement('div'); icon.className = 'entity-icon campaign-icon'; icon.textContent = '◎';
    const title = document.createElement('h3'); title.textContent = campaign.name;
    const detail = document.createElement('p'); detail.textContent = campaign.brief.slice(0, 120);
    const meta = document.createElement('div'); meta.className = 'entity-meta'; meta.textContent = `${campaign.platform} · ${parsed.duration ? `mín. ${parsed.duration} s` : 'duración sin indicar'}${parsed.tag ? ` · ${parsed.tag}` : ''}`;
    const use = document.createElement('button'); use.className = 'secondary-button'; use.textContent = 'Usar en proyecto'; use.addEventListener('click', () => { resetProject(); $('briefText').value = campaign.brief; $('projectNameInput').value = campaign.name; localStorage.setItem(keys.brief, campaign.brief); renderRules(); saveCurrentProject(true); switchView('editor'); });
    card.append(icon, title, detail, meta, use); grid.append(card);
  });
}

function makeEmptyCard(titleText, bodyText, actionText, action) {
  const card = document.createElement('article'); card.className = 'empty-section-card';
  const icon = document.createElement('div'); icon.className = 'sparkle'; icon.textContent = '✳';
  const title = document.createElement('b'); title.textContent = titleText;
  const body = document.createElement('p'); body.textContent = bodyText;
  const button = document.createElement('button'); button.className = 'primary-button'; button.textContent = actionText; button.addEventListener('click', action);
  card.append(icon, title, body, button); return card;
}

function addLibraryFiles(fileList) {
  const files = [...(fileList || [])];
  for (const file of files) if (!state.assets.some((asset) => asset.file === file)) state.assets.unshift({ id: `asset-${Date.now()}-${Math.random()}`, file, name: file.name, size: file.size, type: file.type || 'Archivo' });
  renderLibrary(); if (files.length) toast(`${files.length} ${files.length === 1 ? 'archivo añadido' : 'archivos añadidos'} a la sesión.`);
}

function renderLibrary() {
  const grid = $('libraryGrid'); if (!grid) return;
  $('librarySummary').textContent = `${state.assets.length} ${state.assets.length === 1 ? 'archivo' : 'archivos'} en esta sesión`;
  grid.replaceChildren();
  if (!state.assets.length) { grid.append(makeEmptyCard('Tu biblioteca está vacía', 'Añade música, vídeos o archivos de subtítulos para tenerlos a mano durante esta sesión.', 'Añadir archivos', () => $('libraryFiles').click())); return; }
  state.assets.forEach((asset) => {
    const card = document.createElement('article'); card.className = 'library-asset';
    const icon = document.createElement('div'); icon.className = 'entity-icon asset-icon'; icon.textContent = asset.type.startsWith('audio') ? '♫' : asset.type.startsWith('video') ? '▶' : 'Aa';
    const title = document.createElement('b'); title.textContent = asset.name;
    const meta = document.createElement('span'); meta.textContent = `${formatSize(asset.size)} · solo esta sesión`;
    const actions = document.createElement('div'); actions.className = 'library-actions';
    if (asset.type.startsWith('video')) { const use = document.createElement('button'); use.className = 'secondary-button'; use.textContent = 'Usar en proyecto'; use.addEventListener('click', () => { selectVideo(asset.file); switchView('editor'); }); actions.append(use); }
    const action = document.createElement('button'); action.className = 'quiet-button'; action.textContent = 'Quitar'; action.addEventListener('click', () => { state.assets = state.assets.filter((item) => item.id !== asset.id); renderLibrary(); }); actions.append(action);
    card.append(icon, title, meta, actions); grid.append(card);
  });
}

function savePreferences() {
  state.prefs = { model: $('prefModel').value, language: $('prefLanguage').value, diarization: $('prefDiarization').checked, denoise: $('prefDenoise').checked, music: $('prefMusic').checked };
  localStorage.setItem(keys.prefs, JSON.stringify(state.prefs));
  toast('Preferencias guardadas en este navegador.');
}

function parseBrief(text) {
  const duration = text.match(/duraci[oó]n\s+m[ií]nima[^\d]{0,30}(\d+)\s*(?:s\b|segundos?)/i)?.[1];
  const views = text.match(/(?:visitas\s+m[ií]nimas?[^\d]{0,30}|se revisa al llegar a\s*)([\d.,]+)/i)?.[1]?.replace(/[.,]/g, '');
  const tag = text.match(/@[\w.-]+/)?.[0];
  const channel = text.match(/tiktok|instagram(?: reels)?|youtube(?: shorts)?/i)?.[0];
  const rules = [];
  if (duration) rules.push(`Mínimo ${duration} s`);
  if (views) rules.push(`${Number(views).toLocaleString('es-ES')} visitas`);
  if (tag) rules.push(tag);
  return { duration, views, tag, channel, rules };
}

function renderRules() {
  const text = $('briefText').value.trim();
  const parsed = parseBrief(text);
  $('campaignName').textContent = text.split(/\r?\n/).find(Boolean)?.slice(0, 36) || 'Nueva campaña';
  $('minimumDuration').textContent = parsed.duration ? `${parsed.duration} s` : '—';
  $('minimumViews').textContent = parsed.views ? Number(parsed.views).toLocaleString('es-ES') : '—';
  $('platformName').textContent = parsed.channel ? parsed.channel[0].toUpperCase() + parsed.channel.slice(1) : 'TikTok';
  const target = $('campaignTags');
  target.replaceChildren();
  if (!parsed.rules.length) {
    const span = document.createElement('span'); span.textContent = 'Sin requisitos detectados'; target.append(span);
  } else {
    parsed.rules.forEach((rule) => { const span = document.createElement('span'); span.className = 'rule-pill'; span.textContent = rule; target.append(span); });
  }
  $('detectedRules').hidden = !parsed.rules.length;
  if (parsed.rules.length) {
    $('detectedRules').replaceChildren(...parsed.rules.map((rule) => { const el = document.createElement('span'); el.className = 'rule-pill'; el.textContent = rule; return el; }));
  }
}

async function extractBriefText(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt' || extension === 'md') return file.text();
  if (extension === 'docx') {
    if (!window.mammoth?.extractRawText) throw new Error('No se pudo cargar el lector de Word. Comprueba la conexión a Internet e inténtalo de nuevo.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'pdf') {
    const version = '6.5.438';
    const pdfjs = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || '').join(' '));
    }
    return pages.join('\n\n');
  }
  throw new Error('Formato no compatible. Usa PDF, DOCX, TXT o MD.');
}

function applyBriefText(text, filename) {
  const cleanText = text.trim();
  if (!cleanText) throw new Error('No se encontró texto seleccionable. Si el PDF es un escaneo, necesitará OCR.');
  $('briefText').value = cleanText;
  localStorage.setItem(keys.brief, cleanText);
  renderRules();
  saveCurrentProject(true);
  toast(`Brief cargado localmente desde ${filename}.`);
}

function setServiceState(connected, message) {
  const target = $('serviceStatus');
  target.classList.toggle('connected', connected);
  target.replaceChildren();
  const dot = document.createElement('span'); dot.className = 'status-dot';
  target.append(dot, document.createTextNode(message));
  $('footerStatus').textContent = connected ? 'Backend conectado · los archivos solo se envían al iniciar un trabajo' : 'Backend sin conectar · no se ha enviado ningún archivo';
  $('analyzeButton').disabled = !connected || !state.file || Boolean(state.job);
}

function openServiceDialog() {
  $('apiUrl').value = state.api;
  $('serviceDialog').showModal();
}

function selectVideo(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) return toast('Elige un archivo de vídeo válido.');
  state.file = file;
  addLibraryFiles([file]);
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = URL.createObjectURL(file);
  $('videoName').textContent = file.name;
  $('videoMeta').textContent = `${formatSize(file.size)} · listo para analizar`;
  $('uploadZone').hidden = true;
  $('selectedVideo').hidden = false;
  $('previewVideo').src = state.videoUrl;
  $('previewVideo').load();
  $('previewStage').classList.add('has-video');
  $('previewSeek').disabled = false;
  $('analyzeButton').disabled = !state.api || Boolean(state.job);
  $('footerStatus').textContent = state.api ? 'Vídeo seleccionado · todavía no se ha enviado' : 'Vídeo local · backend sin conectar';
  saveCurrentProject(true);
}

function resetVideo() {
  state.file = null;
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = null;
  $('videoFile').value = '';
  $('previewVideo').removeAttribute('src');
  $('previewVideo').load();
  $('previewStage').classList.remove('has-video');
  $('selectedVideo').hidden = true;
  $('uploadZone').hidden = false;
  $('previewSeek').disabled = true;
  $('analyzeButton').disabled = true;
  $('footerStatus').textContent = state.api ? 'Backend conectado · no se ha enviado ningún archivo' : 'Backend sin conectar · no se ha enviado ningún archivo';
}

async function checkConnection() {
  const raw = $('apiUrl').value.trim().replace(/\/+$/, '');
  if (!raw) { setServiceState(false, 'Introduce la URL de tu backend'); return; }
  try {
    const response = await fetch(`${raw}/health`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`El servicio respondió ${response.status}`);
    const data = await response.json();
    state.api = raw;
    localStorage.setItem(keys.api, raw);
    setServiceState(true, data.status === 'ok' ? 'Servicio conectado' : 'Backend accesible');
    toast('Conexión con el backend correcta.');
  } catch (error) {
    setServiceState(false, error.message || 'No se pudo conectar');
    toast('No se pudo comprobar el servicio. Revisa la URL y CORS.');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function showJob(job) {
  state.job = job;
  const percent = Math.max(0, Math.min(100, Number(job.progress) || 0));
  $('analyzeButton').disabled = job.status === 'queued' || job.status === 'running';
  $('analyzeButton').innerHTML = job.status === 'failed' ? 'Reintentar análisis <span>→</span>' : `${escapeHtml(job.message || 'Analizando episodio')} · ${percent}%`;
  $('footerStatus').textContent = `${job.message || 'Procesando vídeo'} · ${percent}%`;
  if (job.status === 'failed') { toast(job.error || 'El análisis no se pudo completar.'); state.job = null; $('analyzeButton').disabled = !state.api || !state.file; $('analyzeButton').textContent = 'Reintentar análisis'; return; }
  if (job.status === 'completed') {
    state.job = null;
    $('analyzeButton').disabled = false;
    $('analyzeButton').textContent = 'Analizar otra vez';
    renderCandidates(job.candidates || []);
    $('suggestion-count').textContent = `${job.candidates?.length || 0} clips`;
    $('footerStatus').textContent = 'Análisis completado · revisa los momentos sugeridos';
    toast('Análisis completado.');
    return;
  }
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(pollJob, 2500);
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function renderCandidates(candidates) {
  const list = $('candidateList');
  list.replaceChildren();
  $('emptyMoments').hidden = candidates.length > 0;
  list.hidden = candidates.length === 0;
  candidates.slice(0, 4).forEach((candidate, index) => {
    const row = document.createElement('article'); row.className = 'candidate';
    const rank = document.createElement('span'); rank.className = 'candidate-rank'; rank.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('div'); copy.className = 'candidate-copy';
    const title = document.createElement('b'); title.textContent = candidate.title || candidate.hook || 'Momento sugerido';
    const reason = document.createElement('span'); reason.textContent = candidate.reason || candidate.summary || 'Fragmento recomendado por el análisis.';
    const meta = document.createElement('div'); meta.className = 'candidate-meta';
    const range = document.createElement('span'); range.textContent = `${formatTime(candidate.start_time)} – ${formatTime(candidate.end_time)}`;
    const score = document.createElement('span'); score.className = 'candidate-score'; score.textContent = Number.isFinite(Number(candidate.score)) ? `POTENCIAL ${Math.round(Number(candidate.score))}` : 'SELECCIÓN AUTOMÁTICA';
    meta.append(range, score); copy.append(title, reason, meta);
    const use = document.createElement('button'); use.className = 'candidate-use'; use.textContent = 'Previsualizar';
    use.addEventListener('click', () => {
      const preview = candidate.preview_url ? new URL(candidate.preview_url, `${state.api}/`).href : state.videoUrl;
      if (preview) { $('previewVideo').src = preview; $('previewVideo').currentTime = Number(candidate.start_time) || 0; $('previewStage').classList.add('has-video'); }
      $('captionWord').textContent = candidate.hook || candidate.title || 'Clip seleccionado';
      $('captionPreview').hidden = false;
      toast(`Previsualizando el momento ${index + 1}.`);
    });
    row.append(rank, copy, use); list.append(row);
  });
}

async function pollJob() {
  if (!state.job?.id) return;
  try {
    const response = await fetch(`${state.api}/v1/jobs/${encodeURIComponent(state.job.id)}`);
    if (!response.ok) throw new Error(`El estado respondió ${response.status}`);
    showJob(await response.json());
  } catch (error) {
    state.job = null;
    $('analyzeButton').disabled = !state.api || !state.file;
    $('footerStatus').textContent = 'Se perdió la conexión con el trabajo';
    toast(error.message || 'No se pudo consultar el trabajo.');
  }
}

async function startAnalysis() {
  if (!state.api || !state.file) return;
  const consent = window.confirm(`El vídeo «${state.file.name}» (${formatSize(state.file.size)}) y el texto del brief se enviarán a ${new URL(state.api).host} para generar transcripción y clips. ¿Quieres subirlos ahora?`);
  if (!consent) return;
  const form = new FormData();
  form.append('video', state.file, state.file.name);
  form.append('brief', $('briefText').value);
  form.append('language', 'es');
  try {
    $('analyzeButton').disabled = true;
    $('analyzeButton').textContent = 'Enviando vídeo…';
    $('footerStatus').textContent = 'Subiendo vídeo al backend autorizado…';
    const response = await fetch(`${state.api}/v1/jobs`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
    const data = await response.json();
    showJob({ ...data, status: data.status || 'queued', progress: data.progress || 0, message: data.message || 'En cola' });
  } catch (error) {
    $('analyzeButton').disabled = false;
    $('analyzeButton').innerHTML = 'Analizar episodio <span>→</span>';
    $('footerStatus').textContent = 'Error al iniciar el análisis';
    toast(error.message || 'No se pudo iniciar el análisis.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('campaignCount').textContent = String(state.campaigns.length);
  $('briefText').value = localStorage.getItem(keys.brief) || '';
  renderRules();
  if (state.api) {
    $('apiUrl').value = state.api;
    checkConnection();
  } else setServiceState(false, 'Sin conectar');

  $('briefText').addEventListener('input', () => { localStorage.setItem(keys.brief, $('briefText').value); renderRules(); saveCurrentProject(true); });
  $('projectNameInput').addEventListener('input', () => saveCurrentProject(true));
  $('briefFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    toast('Leyendo el brief en este dispositivo…');
    try {
      const text = await extractBriefText(file);
      applyBriefText(text, file.name);
    } catch (error) {
      toast(error.message || 'No se pudo leer el archivo. Puede estar dañado o protegido.');
    } finally {
      event.target.value = '';
    }
  });
  $('clearBrief').addEventListener('click', () => { $('briefText').value = ''; localStorage.removeItem(keys.brief); renderRules(); saveCurrentProject(true); toast('Brief eliminado.'); });
  $('videoFile').addEventListener('change', (event) => selectVideo(event.target.files?.[0]));
  $('browseVideo').addEventListener('click', (event) => { event.stopPropagation(); $('videoFile').click(); });
  $('uploadZone').addEventListener('click', () => $('videoFile').click());
  $('uploadZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('videoFile').click(); } });
  ['dragenter', 'dragover'].forEach((eventName) => $('uploadZone').addEventListener(eventName, (event) => { event.preventDefault(); $('uploadZone').classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => $('uploadZone').addEventListener(eventName, (event) => { event.preventDefault(); $('uploadZone').classList.remove('dragging'); }));
  $('uploadZone').addEventListener('drop', (event) => selectVideo(event.dataTransfer.files?.[0]));
  $('removeVideo').addEventListener('click', resetVideo);
  $('openSettings').addEventListener('click', openServiceDialog);
  $('connectEngine').addEventListener('click', openServiceDialog);
  $('testConnection').addEventListener('click', checkConnection);
  $('serviceDialog').querySelector('.dialog-close').addEventListener('click', () => $('serviceDialog').close());
  $('analyzeButton').addEventListener('click', startAnalysis);
  $('previewVideo').addEventListener('loadedmetadata', () => { $('previewSeek').max = $('previewVideo').duration || 0; });
  $('previewVideo').addEventListener('timeupdate', () => { $('previewSeek').value = $('previewVideo').currentTime; });
  $('previewSeek').addEventListener('input', () => { $('previewVideo').currentTime = Number($('previewSeek').value); });
  $('saveProject').addEventListener('click', () => saveCurrentProject());
  $('newProject').addEventListener('click', () => { if (window.confirm('¿Empezar un proyecto nuevo? El borrador actual se conserva en Proyectos.')) { saveCurrentProject(true); resetProject(); toast('Proyecto nuevo listo.'); } });
  $('addCampaign').addEventListener('click', () => switchView('campaigns'));
  document.querySelector('.edit-icon').addEventListener('click', () => switchView('campaigns'));
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); switchView('editor'); });
});

