const $ = (id) => document.getElementById(id);
const keys = { brief: 'cliplab_studio_brief_v2', api: 'cliplab_studio_api_v2' };
const state = { file: null, videoUrl: null, api: localStorage.getItem(keys.api) || '', job: null, pollTimer: null };

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
  $('briefText').value = localStorage.getItem(keys.brief) || '';
  renderRules();
  if (state.api) {
    $('apiUrl').value = state.api;
    checkConnection();
  } else setServiceState(false, 'Sin conectar');

  $('briefText').addEventListener('input', () => { localStorage.setItem(keys.brief, $('briefText').value); renderRules(); });
  $('briefFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (/\.(txt|md)$/i.test(file.name)) {
      $('briefText').value = await file.text();
      localStorage.setItem(keys.brief, $('briefText').value);
      renderRules();
      toast('Brief cargado. Revisa los requisitos detectados.');
    } else {
      toast('Para PDF y DOCX hace falta conectar el servicio de lectura de briefs.');
      event.target.value = '';
    }
  });
  $('clearBrief').addEventListener('click', () => { $('briefText').value = ''; localStorage.removeItem(keys.brief); renderRules(); toast('Brief eliminado.'); });
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
  $('newProject').addEventListener('click', () => { if (window.confirm('¿Empezar un proyecto nuevo? Se limpiará el brief actual, pero las campañas existentes no se borrarán.')) { $('briefText').value = ''; localStorage.removeItem(keys.brief); resetVideo(); renderRules(); toast('Proyecto nuevo listo.'); } });
  $('addCampaign').addEventListener('click', () => $('briefText').focus());
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active'); if (button.dataset.view !== 'editor') toast(`${button.textContent.trim()} estará disponible al conectar la cuenta del espacio.`); }));
});

