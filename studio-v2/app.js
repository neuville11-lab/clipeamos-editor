const $ = (id) => document.getElementById(id);
const keys = { brief: 'cliplab_studio_brief_v2', api: 'cliplab_studio_api_v2', projects: 'cliplab_studio_projects_v2', campaigns: 'cliplab_studio_campaigns_v2', prefs: 'cliplab_studio_prefs_v3', gtaIdea: 'cliplab_gta6_daily_idea', goal: 'cliplab_goal_query_v1', youtube: 'cliplab_youtube_reference_v1' };
const readStore = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const state = { file: null, videoUrl: null, voiceUrl: null, voiceWords: [], audioMode: 'voice', api: localStorage.getItem(keys.api) || '', job: null, pollTimer: null, view: 'editor', projectId: null, projects: Array.isArray(readStore(keys.projects, [])) ? readStore(keys.projects, []) : [], campaigns: Array.isArray(readStore(keys.campaigns, [])) ? readStore(keys.campaigns, []) : [], assets: [], words: [], previewRange: null, transcriptionId: 0, ttsId: 0, prefs: readStore(keys.prefs, { model: 'small', language: 'es', diarization: false, denoise: false, music: true }) };
let asrWorker = null;
let asrPending = null;
let ttsWorker = null;
let ttsPending = null;
let exportRecorder = null;
let exportTracks = [];

function updateExportState(message) {
  const button = $('exportClip');
  if (!button) return;
  button.disabled = !state.file || !state.previewRange || !Number.isFinite(state.previewRange.end) || state.previewRange.end <= state.previewRange.start || !window.MediaRecorder || (state.audioMode === 'voice' && !state.voiceUrl);
  if (message) $('exportStatus').textContent = message;
}

function applyFraming() {
  const video = $('previewVideo');
  if (!video || !$('cropX')) return;
  const x = Number($('cropX').value);
  const top = Number($('cropTop').value);
  const zoom = Number($('cropZoom').value) / 100;
  $('cropTopValue').textContent = `${top}%`;
  $('cropXValue').textContent = `${x}%`;
  $('cropZoomValue').textContent = `${Math.round(zoom * 100)}%`;
  video.style.objectPosition = `${x}% 50%`;
  video.style.transform = 'none';
  const mask = $('previewMask');
  const enabled = $('hideCam').checked;
  $('maskSettings').hidden = !enabled;
  mask.hidden = !enabled;
  mask.className = `preview-mask ${$('maskPosition').value} ${$('maskStyle').value}`;
  mask.style.width = `${$('maskSize').value}%`;
  $('maskSizeValue').textContent = `${$('maskSize').value}%`;
  updatePreviewCanvas();
}

function drawExportFrame(ctx, video, width, height, includeMask = true, includeCaption = true) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const targetAspect = width / height;
  const zoom = Number($('cropZoom').value) / 100;
  const cutTop = video.videoHeight * Number($('cropTop').value) / 100;
  const visibleHeight = video.videoHeight - cutTop;
  let sw, sh;
  if (video.videoWidth / video.videoHeight > targetAspect) {
    sh = visibleHeight / zoom;
    sw = sh * targetAspect;
  } else {
    sw = video.videoWidth / zoom;
    sh = sw / targetAspect;
  }
  const maxX = Math.max(0, video.videoWidth - sw);
  const sx = maxX * Number($('cropX').value) / 100;
  const sy = cutTop + Math.max(0, (visibleHeight - sh) / 2);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  if (includeMask && $('hideCam').checked) {
    const size = Number($('maskSize').value) / 100 * width;
    const mh = size * 9 / 16;
    const position = $('maskPosition').value;
    const left = position.endsWith('right') ? width - size - width * .05 : width * .05;
    const top = position.startsWith('bottom') ? height - mh - height * .05 : height * .05;
    if ($('maskStyle').value === 'cover') {
      ctx.fillStyle = '#181720'; ctx.fillRect(left, top, size, mh);
    } else {
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, size, mh); ctx.clip();
      ctx.filter = 'blur(18px)'; ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height); ctx.restore();
      ctx.filter = 'none';
    }
  }
  const active = includeCaption ? $('captionWord').textContent.trim() : '';
  if (active) {
    ctx.save(); ctx.font = '800 58px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = '#101018'; ctx.fillStyle = '#d6ff73';
    const words = active.split(/\s+/); const line = words.join(' ');
    const maxWidth = width * .84;
    if (ctx.measureText(line).width <= maxWidth) { ctx.strokeText(line, width / 2, height * .70, maxWidth); ctx.fillText(line, width / 2, height * .70, maxWidth); }
    else { const mid = Math.ceil(words.length / 2); ctx.strokeText(words.slice(0, mid).join(' '), width / 2, height * .68, maxWidth); ctx.fillText(words.slice(0, mid).join(' '), width / 2, height * .68, maxWidth); ctx.strokeText(words.slice(mid).join(' '), width / 2, height * .735, maxWidth); ctx.fillText(words.slice(mid).join(' '), width / 2, height * .735, maxWidth); }
    ctx.restore();
  }
}

function updatePreviewCanvas() {
  const video = $('previewVideo');
  const canvas = $('previewCanvas');
  if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
  drawExportFrame(canvas.getContext('2d'), video, canvas.width, canvas.height, false, false);
}

function getTtsWorker() {
  if (ttsWorker) return ttsWorker;
  ttsWorker = new Worker(new URL('../tts-worker.js?v=voice-1', location.href), { type: 'module' });
  ttsWorker.onmessage = ({ data }) => {
    if (!ttsPending || data.id !== ttsPending.id) return;
    if (data.type === 'progress') { $('voiceStatus').textContent = Number.isFinite(data.progress) ? `Descargando voz · ${Math.round(data.progress)}%` : (data.message || 'Generando voz…'); return; }
    const pending = ttsPending; ttsPending = null;
    if (data.type === 'result') pending.resolve(data);
    else pending.reject(new Error(data.message || 'No se pudo generar la narración.'));
  };
  ttsWorker.onerror = (event) => { if (ttsPending) { ttsPending.reject(new Error(event.message || 'Falló el generador de voz.')); ttsPending = null; } };
  return ttsWorker;
}

function floatAudioToWav(audio, sampleRate) {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + audio.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, audio.length * 2, true);
  for (let i = 0; i < audio.length; i++) { const sample = Math.max(-1, Math.min(1, audio[i])); view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

function refreshAudioMode() {
  state.audioMode = $('audioMode').value;
  const voiceMode = state.audioMode === 'voice';
  $('audioOutputName').textContent = voiceMode ? 'Narración generada' : 'Audio original';
  $('audioOutputDetail').textContent = voiceMode ? 'El audio original quedará silenciado' : 'Se conserva la pista del gameplay';
  $('generateVoice').disabled = Boolean(ttsPending) || !state.previewRange || !$('voiceText').value.trim();
  syncCaption();
  updateExportState(voiceMode ? (state.voiceUrl ? 'Narración lista. Se exportará sin el audio original.' : 'Selecciona un clip, revisa el texto y genera una voz antes de exportar.') : 'Se conservará el audio original del vídeo.');
}

function invalidateVoiceover() {
  if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
  state.voiceUrl = null; $('voicePreview').removeAttribute('src'); $('voicePreview').hidden = true;
  state.voiceWords = [];
  updateExportState(state.audioMode === 'voice' ? 'El texto o la voz cambiaron. Genera la narración de nuevo antes de exportar.' : 'Se conservará el audio original del vídeo.');
}

async function generateVoiceover() {
  const text = $('voiceText').value.trim();
  if (!state.previewRange) return toast('Selecciona un clip antes de generar la voz.');
  if (!text) return toast('No hay texto para narrar. Comprueba la transcripción o escribe el guion.');
  const id = ++state.ttsId;
  $('generateVoice').disabled = true; $('voiceStatus').textContent = 'Cargando el modelo local…';
  try {
    const worker = getTtsWorker();
    const result = await new Promise((resolve, reject) => {
      ttsPending = { id, resolve, reject };
      worker.postMessage({ type: 'synthesize', id, text, voice: $('voiceChoice').value });
    });
    if (id !== state.ttsId) return;
    if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
    const wav = floatAudioToWav(result.audio, result.sampleRate);
    state.voiceUrl = URL.createObjectURL(wav);
    const duration = result.audio.length / result.sampleRate;
    const tokens = text.split(/\s+/).filter(Boolean);
    const weights = tokens.map((word) => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, '').length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = 0;
    state.voiceWords = tokens.map((word, index) => { const start = cursor; cursor += duration * weights[index] / totalWeight; return { word, start, end: index === tokens.length - 1 ? duration : cursor }; });
    $('voicePreview').src = state.voiceUrl; $('voicePreview').hidden = false; $('voicePreview').load();
    $('voiceStatus').textContent = 'Voz generada. Escúchala y edita el texto si quieres cambiarla.';
    syncCaption();
    updateExportState('Narración lista. Se exportará sin el audio original.');
  } catch (error) {
    $('voiceStatus').textContent = error.message || 'No se pudo generar la voz.';
    toast(error.message || 'No se pudo generar la narración.');
  } finally { $('generateVoice').disabled = Boolean(ttsPending) || !state.previewRange || !$('voiceText').value.trim(); }
}

async function exportSelectedClip() {
  if (exportRecorder && exportRecorder.state !== 'inactive') { exportRecorder.stop(); return; }
  const video = $('previewVideo');
  const range = state.previewRange;
  if (!state.file || !range || !video.videoWidth) return toast('Selecciona un fragmento y espera a que cargue el vídeo.');
  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  const canvasStream = canvas.captureStream(30);
  let audioTracks = [];
  const voiceMode = state.audioMode === 'voice';
  const voiceAudio = voiceMode ? $('voicePreview') : null;
  if (voiceMode && voiceAudio.readyState < 2) await new Promise((resolve, reject) => {
    const failed = () => reject(new Error('No se pudo cargar la narración generada.'));
    voiceAudio.addEventListener('canplay', resolve, { once: true });
    voiceAudio.addEventListener('error', failed, { once: true });
  });
  try {
    if (voiceMode && voiceAudio) { voiceAudio.pause(); voiceAudio.currentTime = 0; audioTracks = voiceAudio.captureStream?.().getAudioTracks() || []; }
    else audioTracks = video.captureStream?.().getAudioTracks() || [];
  } catch {}
  if (voiceMode && !audioTracks.length) { canvasStream.getTracks().forEach((track) => track.stop()); return toast('Este navegador no permite añadir la narración al archivo exportado. Prueba Chrome o elige audio original.'); }
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach((track) => track.stop()); return toast('Este navegador no ofrece un formato de grabación compatible.'); }
  const chunks = [];
  try { exportRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 }); }
  catch (error) { stream.getTracks().forEach((track) => track.stop()); return toast(`No se pudo iniciar la exportación: ${error.message}`); }
  exportTracks = stream.getTracks();
  exportRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  exportRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `cliplab-clip-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    exportTracks.forEach((track) => track.stop()); exportTracks = []; exportRecorder = null;
    video.pause(); if (voiceAudio) voiceAudio.pause(); updateExportState(`Exportado (${mimeType.includes('mp4') ? 'MP4' : 'WebM'})${audioTracks.length ? (voiceMode ? ' con narración generada y sin audio original' : ' con audio original') : ' · sin pista de audio en este navegador'}.`);
    $('exportClip').innerHTML = 'Exportar clip <span>↗</span>';
  };
  await new Promise((resolve) => { const done = () => resolve(); video.addEventListener('seeked', done, { once: true }); video.currentTime = range.start; if (Math.abs(video.currentTime - range.start) < .02) resolve(); });
  updateExportState(audioTracks.length ? (voiceMode ? 'Grabando con la narración generada; el audio original está silenciado…' : 'Grabando el fragmento con su audio original…') : 'Grabando el fragmento. Este navegador no permite capturar el audio original.');
  $('exportClip').textContent = 'Detener exportación'; exportRecorder.start(250);
  const frame = () => {
    if (!exportRecorder || exportRecorder.state === 'inactive') return;
    drawExportFrame(ctx, video, canvas.width, canvas.height);
    if (video.currentTime >= range.end || video.ended) { exportRecorder.stop(); return; }
    requestAnimationFrame(frame);
  };
  try { await video.play(); if (voiceAudio) await voiceAudio.play(); requestAnimationFrame(frame); }
  catch (error) { exportRecorder.stop(); toast(`No se pudo reproducir el vídeo para exportar: ${error.message}`); }
}

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
    host.innerHTML = `${commonHead('PREFERENCIAS','Ajustes','Elige cómo debe trabajar el motor cuando esté conectado.')}<div class="settings-grid"><section class="card settings-card"><div class="card-heading"><div class="heading-icon violet">API</div><div><h2>Backend de ClipLab</h2><p>La URL se guarda solo en este navegador. No guardes claves aquí.</p></div></div><div class="settings-content"><label class="field-label" for="settingsApiUrl">URL del servicio</label><div class="settings-inline"><input class="section-input" id="settingsApiUrl" type="url" placeholder="https://api.tu-dominio.com"><button class="secondary-button" id="settingsTestConnection">Probar conexión</button></div><div class="dialog-status" id="settingsServiceStatus"><span class="status-dot"></span> Sin conectar</div></div></section><section class="card settings-card"><div class="card-heading"><div class="heading-icon orange">AI</div><div><h2>Procesamiento de voz</h2><p>Whisper Small mejora la precisión; la primera descarga y el análisis tardan más.</p></div></div><div class="settings-content settings-options"><label class="field-label">Modelo de transcripción<select class="section-input" id="prefModel"><option value="small">Whisper Small · más precisión (recomendado)</option><option value="base">Whisper Base · más rápido</option></select></label><label class="field-label">Idioma de transcripción<select class="section-input" id="prefLanguage"><option value="es">Español</option><option value="auto">Detección automática</option><option value="en">Inglés</option></select></label><label class="toggle-row"><span><b>Identificar quién habla</b><small>Diarización de voces · necesita modelo adicional.</small></span><input type="checkbox" id="prefDiarization"></label><label class="toggle-row"><span><b>Limpiar ruido de voz</b><small>Mejora opcional de audio · añade tiempo de proceso.</small></span><input type="checkbox" id="prefDenoise"></label><label class="toggle-row"><span><b>Incluir base musical</b><small>La música se mezcla por debajo de la voz.</small></span><input type="checkbox" id="prefMusic"></label><button class="primary-button" id="savePrefs">Guardar preferencias</button></div></section><section class="card settings-card privacy-card"><div class="heading-icon dark">▣</div><div><h2>Privacidad y coste</h2><p>El procesamiento en nube enviará el vídeo al backend y a los workers configurados. La política de borrado y el límite de gasto se establecerán antes de activarlo.</p></div></section></div>`;
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
function persistCampaigns() { localStorage.setItem(keys.campaigns, JSON.stringify(state.campaigns)); if ($('campaignCount')) $('campaignCount').textContent = String(state.campaigns.length); }

function saveCurrentProject(silent = false) {
  const brief = $('briefText').value.trim();
  const goal = $('goalQuery')?.value.trim() || '';
  const youtubeUrl = $('youtubeUrl')?.value.trim() || '';
  if (!brief && !goal && !youtubeUrl && !state.file) { if (!silent) toast('Añade una pregunta, un enlace o un vídeo antes de guardar.'); return; }
  const name = $('projectNameInput').value.trim() || goal.slice(0, 48) || state.file?.name || youtubeUrl.slice(0, 48) || 'Proyecto sin título';
  const project = { id: state.projectId || `project-${Date.now()}`, name, brief, goal, youtubeUrl, platform: $('goalPlatform')?.value || 'TikTok', minimum: Number($('clipMinimum')?.value || 10), videoName: state.file?.name || '', updatedAt: Date.now(), status: 'Borrador' };
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
  $('goalQuery').value = '';
  $('focusSummary').textContent = 'Escribe una pregunta para priorizar fragmentos relevantes.';
  $('youtubeUrl').value = '';
  $('sourceMessage').textContent = 'El enlace abre el reproductor de referencia. Para analizar automáticamente, sube el archivo original propio o autorizado.';
  $('sourceEmbedWrap').hidden = true;
  $('sourceEmbed').removeAttribute('src');
  localStorage.removeItem(keys.goal);
  localStorage.removeItem(keys.youtube);
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
  $('goalQuery').value = project.goal || '';
  $('focusSummary').textContent = project.goal || 'Escribe una pregunta para priorizar fragmentos relevantes.';
  $('youtubeUrl').value = project.youtubeUrl || '';
  $('goalPlatform').value = project.platform || 'TikTok';
  $('clipMinimum').value = String(project.minimum || 10);
  $('clipMinimumValue').textContent = `${$('clipMinimum').value} s`;
  if (project.youtubeUrl) setYoutubeReference(project.youtubeUrl, false);
  localStorage.setItem(keys.goal, $('goalQuery').value);
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
    const detail = document.createElement('p'); detail.textContent = project.videoName ? `${project.videoName} · el archivo debe volver a seleccionarse` : (project.goal || project.youtubeUrl || project.brief || 'Sin enfoque guardado').slice(0, 115);
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
  const text = $('briefText')?.value.trim() || '';
  const parsed = parseBrief(text);
  if ($('campaignName')) $('campaignName').textContent = text.split(/\r?\n/).find(Boolean)?.slice(0, 36) || 'Nueva campaña';
  if ($('minimumDuration')) $('minimumDuration').textContent = parsed.duration ? `${parsed.duration} s` : '—';
  if ($('minimumViews')) $('minimumViews').textContent = parsed.views ? Number(parsed.views).toLocaleString('es-ES') : '—';
  if ($('platformName')) $('platformName').textContent = parsed.channel ? parsed.channel[0].toUpperCase() + parsed.channel.slice(1) : 'TikTok';
  const target = $('campaignTags');
  if (target) target.replaceChildren();
  if (target && !parsed.rules.length) {
    const span = document.createElement('span'); span.textContent = 'Sin requisitos detectados'; target.append(span);
  } else if (target) {
    parsed.rules.forEach((rule) => { const span = document.createElement('span'); span.className = 'rule-pill'; span.textContent = rule; target.append(span); });
  }
  if ($('detectedRules')) $('detectedRules').hidden = !parsed.rules.length;
  if (parsed.rules.length && $('detectedRules')) {
    $('detectedRules').replaceChildren(...parsed.rules.map((rule) => { const el = document.createElement('span'); el.className = 'rule-pill'; el.textContent = rule; return el; }));
  }
}

async function extractBriefText(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt' || extension === 'md') return file.text();
  if (extension === 'docx') return extractDocxText(await file.arrayBuffer());
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

async function extractDocxText(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const eocdMin = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= eocdMin; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('El DOCX no parece válido o está dañado.');
  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  let documentEntry = null;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('No se pudo abrir el contenido del DOCX.');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength));
    if (path === 'word/document.xml') {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      documentEntry = { method, data: bytes.slice(dataOffset, dataOffset + compressedSize) };
      break;
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  if (!documentEntry) throw new Error('El DOCX no contiene el texto principal del documento.');
  let xmlBytes;
  if (documentEntry.method === 0) xmlBytes = documentEntry.data;
  else if (documentEntry.method === 8 && 'DecompressionStream' in window) {
    const stream = new Blob([documentEntry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error('Este navegador no puede descomprimir este DOCX. Prueba a guardarlo de nuevo como .docx.');
  const xml = new DOMParser().parseFromString(decoder.decode(xmlBytes), 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('No se pudo interpretar el contenido del DOCX.');
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = [...xml.getElementsByTagNameNS(namespace, 'p')];
  const textOf = (node) => {
    if (node.namespaceURI === namespace && node.localName === 't') return node.textContent || '';
    if (node.namespaceURI === namespace && node.localName === 'tab') return '\t';
    if (node.namespaceURI === namespace && ['br', 'cr'].includes(node.localName)) return '\n';
    return [...node.childNodes].map(textOf).join('');
  };
  return paragraphs.map(textOf).join('\n');
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
  $('footerStatus').textContent = connected ? 'Backend opcional conectado · transcripción local disponible' : 'Whisper local · el vídeo se procesa en este dispositivo';
  $('analyzeButton').disabled = !state.file || !state.words.length || !$('goalQuery')?.value.trim() || Boolean(state.job);
}

function setYoutubeReference(rawUrl, notify = true) {
  let url;
  try { url = new URL(rawUrl.trim()); } catch { return toast('Pega un enlace completo de YouTube.'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (!['youtube.com', 'youtu.be'].includes(host)) return toast('Usa un enlace de youtube.com o youtu.be.');
  let id = host === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : (url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1]);
  if (!id || !/^[\w-]{11}$/.test(id)) return toast('No he podido reconocer el ID del vídeo de YouTube.');
  $('youtubeUrl').value = url.href;
  $('sourceEmbed').src = `https://www.youtube-nocookie.com/embed/${id}`;
  $('sourceEmbedWrap').hidden = false;
  $('sourceMessage').textContent = 'Enlace cargado como referencia. Para transcribirlo, selecciona también el archivo original propio o autorizado; el reproductor de YouTube no expone el vídeo al editor.';
  localStorage.setItem(keys.youtube, url.href);
  if (notify) { saveCurrentProject(true); toast('Vídeo de referencia añadido.'); }
}

function openServiceDialog() {
  $('apiUrl').value = state.api;
  $('serviceDialog').showModal();
}

function selectVideo(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) return toast('Elige un archivo de vídeo válido.');
  state.file = file;
  state.words = [];
  state.previewRange = null;
  state.ttsId++;
  if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
  state.voiceUrl = null;
  state.voiceWords = [];
  $('voicePreview').removeAttribute('src'); $('voicePreview').hidden = true;
  $('voiceText').value = ''; $('generateVoice').disabled = true;
  $('voiceStatus').textContent = 'Transcribe el vídeo y selecciona un clip para preparar la narración.';
  updateExportState('Transcribe el vídeo y selecciona un momento para preparar la exportación.');
  addLibraryFiles([file]);
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.videoUrl = URL.createObjectURL(file);
  $('videoName').textContent = file.name;
  $('videoMeta').textContent = `${formatSize(file.size)} · Whisper local`;
  $('uploadZone').hidden = true;
  $('selectedVideo').hidden = false;
  $('previewVideo').src = state.videoUrl;
  $('previewVideo').load();
  $('previewStage').classList.add('has-video');
  $('previewSeek').disabled = false;
  $('analyzeButton').disabled = true;
  $('footerStatus').textContent = 'Vídeo local · preparando transcripción Whisper';
  saveCurrentProject(true);
  transcribeLocally(file);
}

function resetVideo() {
  state.transcriptionId++;
  state.words = [];
  state.previewRange = null;
  state.ttsId++;
  state.file = null;
  if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
  state.voiceUrl = null;
  state.voiceWords = [];
  $('voicePreview').removeAttribute('src'); $('voicePreview').hidden = true;
  $('voiceText').value = ''; $('generateVoice').disabled = true;
  updateExportState('Sube un vídeo y selecciona un momento para exportar.');
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
  $('footerStatus').textContent = 'Sin vídeo · no se ha enviado ningún archivo';
  $('engineStatus').textContent = 'Sube un vídeo para transcribirlo aquí, sin subirlo a la nube.';
  renderCandidates([]);
}

function getAsrWorker() {
  if (asrWorker) return asrWorker;
  asrWorker = new Worker(new URL('../asr-worker.js?v=asr-small-1', location.href), { type: 'module' });
  asrWorker.onmessage = ({ data }) => {
    if (!asrPending || data.id !== asrPending.id) return;
    if (data.type === 'progress') {
      const message = Number.isFinite(data.progress)
        ? `Descargando Whisper · ${Math.round(data.progress)}% · ${data.message || ''}`
        : (data.message || 'Whisper está transcribiendo en este dispositivo…');
      $('engineStatus').textContent = message;
      $('footerStatus').textContent = message;
      return;
    }
    const pending = asrPending;
    asrPending = null;
    if (data.type === 'result') pending.resolve(data.chunks || []);
    else pending.reject(new Error(data.message || 'No se pudo completar la transcripción.'));
  };
  asrWorker.onerror = (event) => {
    if (!asrPending) return;
    asrPending.reject(new Error(event.message || 'Falló el worker Whisper.'));
    asrPending = null;
  };
  return asrWorker;
}

function transcribeInWorker(file, id, options) {
  const worker = getAsrWorker();
  return new Promise((resolve, reject) => {
    asrPending = { id, resolve, reject };
    worker.postMessage({ type: 'transcribe', id, file, ...options });
  });
}

function wordsFromChunks(chunks) {
  const words = [];
  for (const chunk of chunks || []) {
    const text = String(chunk.text || '').trim();
    const times = chunk.timestamp || chunk.timestamps;
    if (!text || !times || !Number.isFinite(times[0]) || !Number.isFinite(times[1]) || times[1] <= times[0]) continue;
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 1) { words.push({ word: parts[0], start: times[0], end: times[1] }); continue; }
    const weights = parts.map((word) => Math.max(1, word.length));
    const sum = weights.reduce((total, value) => total + value, 0);
    let cursor = times[0];
    parts.forEach((word, index) => {
      const end = index === parts.length - 1 ? times[1] : cursor + (times[1] - times[0]) * weights[index] / sum;
      words.push({ word, start: cursor, end }); cursor = end;
    });
  }
  return words;
}

async function transcribeLocally(file) {
  const id = ++state.transcriptionId;
  $('engineStatus').textContent = 'Preparando el audio local… El vídeo no se enviará.';
  $('footerStatus').textContent = 'Whisper se está preparando en segundo plano';
  try {
    const chunks = await transcribeInWorker(file, id, { model: state.prefs.model || 'small', language: state.prefs.language || 'es' });
    if (id !== state.transcriptionId) return;
    state.words = wordsFromChunks(chunks);
    if (!state.words.length) throw new Error('Whisper no devolvió palabras con tiempos.');
    $('engineStatus').textContent = `Transcripción lista · ${state.words.length.toLocaleString('es-ES')} palabras con tiempos · procesada en este dispositivo.`;
    $('videoMeta').textContent = `${formatSize(file.size)} · ${state.words.length.toLocaleString('es-ES')} palabras transcritas`;
    $('footerStatus').textContent = 'Transcripción local completada · ClipLab busca momentos';
    suggestLocalMoments();
    $('analyzeButton').disabled = !$('goalQuery').value.trim();
  } catch (error) {
    if (id !== state.transcriptionId) return;
    $('engineStatus').textContent = `No se pudo transcribir automáticamente: ${error.message}. Comprueba la conexión para descargar el modelo Whisper.`;
    $('footerStatus').textContent = 'Transcripción local interrumpida';
    toast(error.message || 'No se pudo transcribir el vídeo.');
  }
}

function suggestLocalMoments() {
  const duration = Number($('previewVideo').duration);
  if (!Number.isFinite(duration) || duration <= 0 || !state.words.length) {
    $('emptyMoments').querySelector('span').textContent = 'Whisper terminará la transcripción y ClipLab buscará momentos interesantes automáticamente.';
    return;
  }
  const minimum = Number($('clipMinimum').value) || 10;
  const focus = $('goalQuery').value.trim();
  if (!focus) {
    $('emptyMoments').querySelector('span').textContent = 'Escribe qué respuesta, duda o tema estás buscando para ordenar los fragmentos por relevancia.';
    renderCandidates([]);
    return;
  }
  if (duration < minimum) {
    $('emptyMoments').querySelector('span').textContent = `El vídeo dura ${Math.floor(duration)} s y el mínimo elegido es ${minimum} s.`;
    renderCandidates([]);
    return;
  }
  const target = Math.min(duration, Math.max(minimum, Math.min(45, duration)));
  const step = Math.max(5, target * 0.32);
  const starts = [];
  for (let start = 0; start + minimum <= duration; start += step) starts.push(start);
  if (duration > target) starts.push(duration - target);
  const candidates = [];
  for (const start of starts) {
    const end = Math.min(duration, start + target);
    if (end - start < minimum) continue;
    const words = state.words.filter((word) => word.start < end && word.end > start);
    const text = words.map((word) => word.word).join(' ').trim();
    if (text.length < 28) continue;
    let score = Math.min(text.length / 150, 2);
    const normalize = (value) => value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const stopWords = new Set(['que', 'para', 'con', 'como', 'por', 'una', 'uno', 'del', 'las', 'los', 'esto', 'esta', 'este', 'sobre', 'quiero', 'hacer', 'short', 'video']);
    const focusTerms = [...new Set(normalize(focus).match(/[a-z0-9]{3,}/g) || [])].filter((term) => !stopWords.has(term));
    const normalizedText = normalize(text);
    let matchedTerms = 0;
    for (const term of focusTerms) if (normalizedText.includes(term)) { score += 2.5; matchedTerms++; }
    const signals = [
      [/\b(pero|aunque|sin embargo|el problema|la clave|lo importante)\b/i, 2],
      [/\b(nunca|siempre|nadie|error|secreto|sorpresa|incre[ií]ble)\b/i, 2.2],
      [/\b(porque|por eso|significa|aprend[ií]|descubr[ií])\b/i, 1],
      [/[?!]/, 0.5],
      [/\b(euros?|inversi[oó]n|vivienda|alquiler|millones?)\b/i, 0.8],
    ];
    for (const [pattern, weight] of signals) if (pattern.test(text)) score += weight;
    const keyLine = text.match(/[^.!?]{0,90}\b(pero|aunque|nunca|siempre|problema|clave|secreto|sorpresa)\b[^.!?]{0,90}/i)?.[0]?.trim();
    candidates.push({
      title: (keyLine || text).slice(0, 90), hook: keyLine || text.slice(0, 90),
      reason: `${matchedTerms} términos del enfoque coinciden con este fragmento. Priorización local orientativa; revisa el contexto.`,
      start_time: start, end_time: end, score: Math.min(99, 35 + score * 8),
    });
  }
  const selected = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (selected.every((item) => Math.abs(item.start_time - candidate.start_time) > target * 0.65)) selected.push(candidate);
    if (selected.length === 4) break;
  }
  selected.sort((a, b) => a.start_time - b.start_time);
  if (!selected.length) $('emptyMoments').querySelector('span').textContent = 'No se encontraron suficientes palabras con tiempos para proponer clips.';
  renderCandidates(selected);
  $('suggestion-count').textContent = `${selected.length} clips`;
  if (selected.length) $('footerStatus').textContent = `${state.words.length.toLocaleString('es-ES')} palabras · prioridad: «${focus}» · ${selected.length} propuestas`;
}

function prepareGtaIdea() {
  const category = $('ideaCategory').value;
  const question = $('ideaProblem').value.trim() || $('goalQuery').value.trim();
  const notes = $('ideaNotes').value.trim();
  if (!question) { $('ideaProblem').focus(); return toast('Escribe la duda concreta que quieres resolver.'); }
  const starts = {
    cars: `¿Qué coche de GTA 6 te conviene para ${question}?`,
    updates: `Antes de probar ${question}, mira qué cambia y a quién le sirve.`,
    guide: `Si necesitas ${question}, aquí tienes una guía rápida.`,
    problem: `¿Te está pasando esto: ${question}? Prueba este método.`,
    secrets: `¿Te has fijado en ${question}? Esto es lo que sabemos y cómo comprobarlo.`,
  };
  const hook = starts[category] || starts.guide;
  const title = `GTA 6: ${question}`;
  const script = `${hook}\n\n1. Explica la situación en una frase.\n2. Da la solución o comparación en 2–3 pasos.\n3. Cierra con el resultado que debería notar el jugador.\n\nDatos por revisar:\n${notes || '[Añade solo datos confirmados y el enlace de la fuente antes de grabar.]'}\n\nCierre: “Guarda este vídeo para probarlo y dime qué otra duda de GTA 6 resolvemos.”`;
  const output = $('ideaOutput');
  output.replaceChildren();
  const heading = document.createElement('b'); heading.textContent = 'Guion base · revísalo con una fuente actual';
  const titleNode = document.createElement('p'); titleNode.className = 'idea-title'; titleNode.textContent = title;
  const body = document.createElement('pre'); body.textContent = script;
  const caption = document.createElement('p'); caption.textContent = `${hook}\n\n#GTA6 #GTAVI #Gaming`;
  const copy = document.createElement('button'); copy.className = 'secondary-button'; copy.textContent = 'Copiar guion y descripción';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${title}\n\n${script}\n\nDescripción:\n${caption.textContent}`); toast('Guion copiado.'); }
    catch { toast('El navegador no permitió copiar. Selecciona el texto del guion.'); }
  });
  output.append(heading, titleNode, body, caption, copy);
  output.hidden = false;
  localStorage.setItem(keys.gtaIdea, JSON.stringify({ category, question, notes, date: new Date().toISOString().slice(0, 10) }));
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
    state.words = job.words || [];
    $('analyzeButton').disabled = false;
    $('analyzeButton').textContent = 'Analizar otra vez';
    renderCandidates(job.candidates || []);
    $('suggestion-count').textContent = `${job.candidates?.length || 0} clips`;
    $('footerStatus').textContent = 'Análisis completado · revisa los momentos sugeridos';
    if (state.words.length) toast(`Transcripción lista · ${state.words.length.toLocaleString('es-ES')} palabras con tiempos.`);
    else toast('Análisis completado.');
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
    const score = document.createElement('span'); score.className = 'candidate-score'; score.textContent = Number.isFinite(Number(candidate.score)) ? `RELEVANCIA ${Math.round(Number(candidate.score))}` : 'SELECCIÓN AUTOMÁTICA';
    meta.append(range, score); copy.append(title, reason, meta);
    const use = document.createElement('button'); use.className = 'candidate-use'; use.textContent = 'Previsualizar';
    use.addEventListener('click', () => {
      const preview = state.videoUrl || (candidate.preview_url ? new URL(candidate.preview_url, `${state.api}/`).href : null);
      state.previewRange = { start: Number(candidate.start_time) || 0, end: Number(candidate.end_time) || 0 };
      state.ttsId++;
      if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
      state.voiceUrl = null; $('voicePreview').removeAttribute('src'); $('voicePreview').hidden = true;
      state.voiceWords = [];
      $('voiceText').value = state.words.filter((word) => word.start < state.previewRange.end && word.end > state.previewRange.start).map((word) => word.word).join(' ').trim();
      $('generateVoice').disabled = !$('voiceText').value;
      $('voiceStatus').textContent = $('voiceText').value ? 'Revisa el texto, elige una voz y genera la narración.' : 'No hay transcripción para este fragmento. Escribe el texto que quieres narrar.';
      refreshAudioMode();
      if (preview) { $('previewVideo').src = preview; $('previewVideo').currentTime = state.previewRange.start; $('previewStage').classList.add('has-video'); }
      syncCaption();
      $('captionPreview').hidden = false;
      toast(`Previsualizando el momento ${index + 1}.`);
    });
    row.append(rank, copy, use); list.append(row);
  });
}

function syncCaption() {
  const video = $('previewVideo');
  if (!state.previewRange || !video) return;
  const generated = state.audioMode === 'voice' && Boolean(state.voiceUrl) && state.voiceWords.length > 0;
  const sourceWords = generated ? state.voiceWords : state.words;
  if (!sourceWords.length) { $('captionPreview').hidden = true; return; }
  const now = generated ? video.currentTime - state.previewRange.start : video.currentTime;
  const visible = generated ? sourceWords : sourceWords.filter((word) => word.start >= state.previewRange.start && word.start < state.previewRange.end);
  if (generated && now >= visible[visible.length - 1].end) { $('captionPreview').hidden = true; return; }
  const index = visible.findIndex((word) => now >= word.start && now < word.end);
  const active = index >= 0 ? index : visible.findIndex((word) => word.start > now);
  if (active < 0) return;
  const from = Math.max(0, active - 2);
  const phrase = visible.slice(from, Math.min(visible.length, from + 5));
  $('captionPreview').hidden = false;
  const host = $('captionWord');
  host.replaceChildren(...phrase.map((item, offset) => {
    const span = document.createElement('span');
    span.textContent = `${item.word}${offset < phrase.length - 1 ? ' ' : ''}`;
    span.style.opacity = from + offset === active ? '1' : '.72';
    span.style.textDecoration = from + offset === active ? 'underline' : 'none';
    return span;
  }));
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
  if ($('campaignCount')) $('campaignCount').textContent = String(state.campaigns.length);
  $('briefText').value = localStorage.getItem(keys.brief) || '';
  $('goalQuery').value = localStorage.getItem(keys.goal) || '';
  $('youtubeUrl').value = localStorage.getItem(keys.youtube) || '';
  if ($('youtubeUrl').value) setYoutubeReference($('youtubeUrl').value, false);
  $('focusSummary').textContent = $('goalQuery').value || 'Escribe una pregunta para priorizar fragmentos relevantes.';
  const savedIdea = readStore(keys.gtaIdea, null);
  if (savedIdea) {
    $('ideaCategory').value = savedIdea.category || 'cars';
    $('ideaProblem').value = savedIdea.question || '';
    $('ideaNotes').value = savedIdea.notes || '';
    if (savedIdea.question) prepareGtaIdea();
  }
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
  $('useYoutubeUrl').addEventListener('click', () => setYoutubeReference($('youtubeUrl').value));
  $('youtubeUrl').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); setYoutubeReference($('youtubeUrl').value); } });
  $('goalQuery').addEventListener('input', () => {
    const goal = $('goalQuery').value.trim();
    localStorage.setItem(keys.goal, goal);
    $('focusSummary').textContent = goal || 'Escribe una pregunta para priorizar fragmentos relevantes.';
    $('analyzeButton').disabled = !goal || !state.words.length;
    saveCurrentProject(true);
  });
  $('goalQuery').addEventListener('change', () => { if (state.words.length) suggestLocalMoments(); });
  $('clipMinimum').addEventListener('input', () => {
    $('clipMinimumValue').textContent = `${$('clipMinimum').value} s`;
    localStorage.setItem('cliplab_clip_minimum_v1', $('clipMinimum').value);
    if (state.words.length) suggestLocalMoments();
  });
  $('clipMinimum').value = localStorage.getItem('cliplab_clip_minimum_v1') || '10';
  $('clipMinimumValue').textContent = `${$('clipMinimum').value} s`;
  $('goalPlatform').value = localStorage.getItem('cliplab_goal_platform_v1') || 'TikTok';
  $('goalPlatform').addEventListener('change', () => { localStorage.setItem('cliplab_goal_platform_v1', $('goalPlatform').value); saveCurrentProject(true); });
  $('openSettings').addEventListener('click', openServiceDialog);
  $('connectEngine').addEventListener('click', () => state.file ? transcribeLocally(state.file) : toast('Sube un vídeo para iniciar Whisper local.'));
  $('testConnection').addEventListener('click', checkConnection);
  $('serviceDialog').querySelector('.dialog-close').addEventListener('click', () => $('serviceDialog').close());
  $('analyzeButton').addEventListener('click', suggestLocalMoments);
  $('prepareIdea').addEventListener('click', prepareGtaIdea);
  ['ideaCategory', 'ideaProblem', 'ideaNotes'].forEach((id) => $(id).addEventListener('change', () => {
    localStorage.setItem(keys.gtaIdea, JSON.stringify({ category: $('ideaCategory').value, question: $('ideaProblem').value, notes: $('ideaNotes').value, date: new Date().toISOString().slice(0, 10) }));
  }));
  $('previewVideo').addEventListener('loadedmetadata', () => { $('previewSeek').max = $('previewVideo').duration || 0; applyFraming(); if (state.words.length) suggestLocalMoments(); });
  $('previewVideo').addEventListener('timeupdate', () => { $('previewSeek').value = $('previewVideo').currentTime; syncCaption(); updatePreviewCanvas(); });
  $('previewVideo').addEventListener('seeked', updatePreviewCanvas);
  ['cropTop', 'cropX', 'cropZoom', 'hideCam', 'maskPosition', 'maskStyle', 'maskSize'].forEach((id) => $(id).addEventListener('input', applyFraming));
  $('exportClip').addEventListener('click', exportSelectedClip);
  $('audioMode').addEventListener('change', refreshAudioMode);
  $('generateVoice').addEventListener('click', generateVoiceover);
      $('voiceText').addEventListener('input', () => { state.ttsId++; invalidateVoiceover(); $('generateVoice').disabled = Boolean(ttsPending) || !state.previewRange || !$('voiceText').value.trim(); });
  $('voiceChoice').addEventListener('change', () => { state.ttsId++; if (state.voiceUrl) { invalidateVoiceover(); $('voiceStatus').textContent = 'Voz cambiada. Genera la narración de nuevo.'; } });
  $('previewSeek').addEventListener('input', () => { $('previewVideo').currentTime = Number($('previewSeek').value); });
  applyFraming(); refreshAudioMode();
  $('saveProject').addEventListener('click', () => saveCurrentProject());
  $('newProject').addEventListener('click', () => { if (window.confirm('¿Empezar un proyecto nuevo? El borrador actual se conserva en Proyectos.')) { saveCurrentProject(true); resetProject(); toast('Proyecto nuevo listo.'); } });
  $('addCampaign')?.addEventListener('click', () => switchView('campaigns'));
  document.querySelector('.edit-icon')?.addEventListener('click', () => switchView('campaigns'));
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); switchView('editor'); });
});

