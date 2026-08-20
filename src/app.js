import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  file: null,
  sourceURL: null,
  outputURL: null,
  duration: 0,
  start: 0,
  end: 0,
  ffmpeg: null,
  ffmpegLoaded: false,
  transcriber: null,
  chunks: [],
  srt: '',
  rendering: false,
};

const el = {
  input: $('#video-input'), dropzone: $('#dropzone'), fileCard: $('#file-card'), fileName: $('#file-name'), fileMeta: $('#file-meta'), replace: $('#replace-file'), rights: $('#rights'), toCut: $('#to-cut'),
  source: $('#source-video'), start: $('#start-time'), end: $('#end-time'), aspect: $('#aspect'), quality: $('#quality'), seek: $('#seek'), current: $('#current-time'), setStart: $('#set-start'), setEnd: $('#set-end'), preview: $('#preview'), clipDuration: $('#clip-duration'), toCaption: $('#to-caption'),
  transcript: $('#transcript'), transcribe: $('#transcribe'), transcribeStatus: $('#transcribe-status'), burn: $('#burn'), captionPosition: $('#caption-position'), downloadSrt: $('#download-srt'), toExport: $('#to-export'),
  output: $('#output-video'), outputEmpty: $('#output-empty'), render: $('#render'), downloadVideo: $('#download-video'), warning: $('#render-warning'), progressWrap: $('#progress-wrap'), progressLabel: $('#progress-label'), progressValue: $('#progress-value'), progressBar: $('#progress-bar'),
  postTitle: $('#post-title'), postDescription: $('#post-description'), generateCopy: $('#generate-copy'), copyPost: $('#copy-post'),
  sumFile: $('#sum-file'), sumClip: $('#sum-clip'), sumFormat: $('#sum-format'), sumCaption: $('#sum-caption'),
};

const fmt = (seconds, ms = false) => {
  const n = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = Math.floor(n % 60), milli = Math.floor((n % 1) * 1000);
  const base = `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return ms ? `${base},${String(milli).padStart(3, '0')}` : base;
};

const size = (bytes) => {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
};

const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);

function stage(n) {
  $$('.stage').forEach((x) => x.classList.toggle('active', Number(x.dataset.stage) === n));
  $$('[data-stage-button]').forEach((x) => x.classList.toggle('active', Number(x.dataset.stageButton) === n));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function unlock(n) {
  $$('[data-stage-button]').forEach((x) => { if (Number(x.dataset.stageButton) <= n) x.disabled = false; });
}

function progress(value, label) {
  el.progressWrap.classList.remove('hidden');
  el.progressBar.style.width = `${value}%`;
  el.progressValue.textContent = `${value}%`;
  el.progressLabel.textContent = label;
}

function clearOutput() {
  if (state.outputURL) URL.revokeObjectURL(state.outputURL);
  state.outputURL = null;
  el.output.removeAttribute('src');
  el.output.load();
  el.outputEmpty.classList.remove('hidden');
  el.downloadVideo.classList.add('hidden');
}

function resetDerived() {
  clearOutput();
  state.chunks = [];
  state.srt = '';
  el.transcript.value = '';
  el.downloadSrt.disabled = true;
  el.transcribeStatus.textContent = 'Nenhuma transcrição executada.';
  el.sumCaption.textContent = 'Pendente';
}

function selectFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) return alert('Selecione um arquivo de vídeo válido.');
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL);
  resetDerived();
  state.file = file;
  state.sourceURL = URL.createObjectURL(file);
  el.source.src = state.sourceURL;
  el.fileName.textContent = file.name;
  el.fileMeta.textContent = `${size(file.size)} · ${file.type || 'vídeo'}`;
  el.fileCard.classList.remove('hidden');
  el.sumFile.textContent = file.name;
  el.rights.checked = false;
  el.toCut.disabled = true;
}

function updateClip() {
  state.start = Math.max(0, Number(el.start.value) || 0);
  state.end = Math.min(state.duration || Infinity, Math.max(state.start + .1, Number(el.end.value) || 0));
  const d = Math.max(0, state.end - state.start);
  el.clipDuration.textContent = fmt(d);
  el.sumClip.textContent = `${fmt(state.start)} → ${fmt(state.end)} · ${fmt(d)}`;
  el.sumFormat.textContent = el.aspect.value === 'vertical' ? '9:16' : 'Original';
}

function clipError() {
  updateClip();
  const d = state.end - state.start;
  if (!state.file) return 'Selecione um vídeo primeiro.';
  if (d < .5) return 'O trecho precisa ter pelo menos 0,5 segundo.';
  if (state.end > state.duration + .05) return 'O fim do corte ultrapassa a duração do vídeo.';
  if (d > 180) return 'Para este MVP, use cortes de até 3 minutos.';
  return null;
}

function makeSrt(chunks, text, duration) {
  let parts = (chunks || []).filter((c) => c?.text?.trim() && Array.isArray(c.timestamp));
  if (!parts.length && text.trim()) {
    const words = text.trim().split(/\s+/);
    const groups = [];
    for (let i = 0; i < words.length; i += 8) groups.push(words.slice(i, i + 8).join(' '));
    const segment = Math.max(1.2, duration / Math.max(1, groups.length));
    parts = groups.map((t, i) => ({ text: t, timestamp: [i * segment, Math.min(duration, (i + 1) * segment)] }));
  }
  return parts.map((p, i) => {
    const start = Math.max(0, Number(p.timestamp?.[0]) || 0);
    const rawEnd = p.timestamp?.[1];
    const end = Math.max(start + .3, Number(rawEnd ?? start + 2) || start + 2);
    return `${i + 1}\n${fmt(start, true)} --> ${fmt(end, true)}\n${p.text.trim()}\n`;
  }).join('\n');
}

function refreshSrt() {
  state.srt = makeSrt(state.chunks, el.transcript.value, Math.max(0, state.end - state.start));
  el.downloadSrt.disabled = !state.srt;
  el.sumCaption.textContent = state.srt ? (el.burn.checked ? 'Pronta' : 'Arquivo separado') : 'Pendente';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ensureFFmpeg() {
  if (state.ffmpegLoaded && state.ffmpeg) return state.ffmpeg;
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress: p }) => {
    if (state.rendering && Number.isFinite(p)) progress(Math.max(1, Math.min(98, Math.round(p * 100))), 'Renderizando vídeo…');
  });
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
  progress(2, 'Carregando motor de vídeo…');
  await ffmpeg.load({ coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'), wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm') });
  state.ffmpeg = ffmpeg; state.ffmpegLoaded = true;
  return ffmpeg;
}

async function writeInput(ffmpeg) {
  const ext = safeName((state.file.name.split('.').pop() || 'mp4').toLowerCase());
  const name = `input.${ext}`;
  try { await ffmpeg.deleteFile(name); } catch {}
  await ffmpeg.writeFile(name, await fetchFile(state.file));
  return name;
}

async function transcribe() {
  const error = clipError();
  if (error) return alert(error);
  el.transcribe.disabled = true;
  el.transcribeStatus.textContent = 'Preparando áudio…';
  try {
    const ffmpeg = await ensureFFmpeg();
    const input = await writeInput(ffmpeg);
    try { await ffmpeg.deleteFile('clip.wav'); } catch {}
    await ffmpeg.exec(['-ss', String(state.start), '-i', input, '-t', String(state.end - state.start), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'clip.wav']);
    const wav = await ffmpeg.readFile('clip.wav');
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData((await new Blob([wav], { type: 'audio/wav' }).arrayBuffer()).slice(0));
    const audio = decoded.getChannelData(0);
    await ctx.close();

    if (!state.transcriber) {
      el.transcribeStatus.textContent = 'Carregando Whisper local…';
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      const model = 'onnx-community/whisper-tiny';
      if (navigator.gpu) {
        try { state.transcriber = await pipeline('automatic-speech-recognition', model, { device: 'webgpu' }); }
        catch { state.transcriber = await pipeline('automatic-speech-recognition', model, { device: 'wasm' }); }
      } else state.transcriber = await pipeline('automatic-speech-recognition', model, { device: 'wasm' });
    }

    el.transcribeStatus.textContent = 'Transcrevendo localmente…';
    const result = await state.transcriber(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' });
    const normalized = Array.isArray(result) ? result[0] : result;
    el.transcript.value = normalized?.text?.trim() || '';
    state.chunks = normalized?.chunks || [];
    refreshSrt();
    el.transcribeStatus.textContent = state.srt ? 'Transcrição concluída. Revise o texto antes de exportar.' : 'Nenhum texto foi reconhecido.';
  } catch (err) {
    console.error(err);
    el.transcribeStatus.textContent = `Falha na transcrição automática: ${err?.message || 'erro desconhecido'}. Você pode inserir o texto manualmente.`;
  } finally {
    el.transcribe.disabled = false;
    el.progressWrap.classList.add('hidden');
  }
}

function generateCopy() {
  const raw = el.transcript.value.trim().replace(/\s+/g, ' ');
  if (!raw) {
    el.postTitle.value = 'Novo corte';
    el.postDescription.value = 'Adicione uma transcrição para gerar uma sugestão de texto.\n\n#shorts #video';
    return;
  }
  const words = raw.split(' ');
  let title = words.slice(0, 12).join(' ');
  if (title.length > 82) title = `${title.slice(0, 79).trim()}…`;
  el.postTitle.value = title.charAt(0).toUpperCase() + title.slice(1);
  const excerpt = raw.length > 220 ? `${raw.slice(0, 217).trim()}…` : raw;
  el.postDescription.value = `${excerpt}\n\n#shorts #tiktok #cortes`;
}

async function render() {
  const error = clipError();
  if (error) return alert(error);
  if (state.rendering) return;
  state.rendering = true; el.render.disabled = true; el.warning.classList.add('hidden'); el.downloadVideo.classList.add('hidden');
  progress(1, 'Preparando renderização…');
  try {
    const ffmpeg = await ensureFFmpeg();
    const input = await writeInput(ffmpeg);
    try { await ffmpeg.deleteFile('output.mp4'); } catch {}
    try { await ffmpeg.deleteFile('captions.srt'); } catch {}
    refreshSrt();
    if (state.srt) await ffmpeg.writeFile('captions.srt', new TextEncoder().encode(state.srt));

    const standard = el.quality.value === 'standard';
    const width = standard ? 720 : 540, height = standard ? 1280 : 960;
    const filters = [];
    if (el.aspect.value === 'vertical') filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
    const wantsCaptions = el.burn.checked && Boolean(state.srt);
    if (wantsCaptions) {
      const align = el.captionPosition.value === 'center' ? 5 : 2;
      const margin = el.captionPosition.value === 'center' ? 0 : Math.round(height * .075);
      filters.push(`subtitles=captions.srt:force_style='FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=${align},MarginV=${margin}'`);
    }

    const args = ['-ss', String(state.start), '-i', input, '-t', String(state.end - state.start)];
    if (filters.length) args.push('-vf', filters.join(','));
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', standard ? '23' : '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'output.mp4');

    let captionFallback = false;
    try { await ffmpeg.exec(args); }
    catch (err) {
      if (!wantsCaptions) throw err;
      captionFallback = true;
      try { await ffmpeg.deleteFile('output.mp4'); } catch {}
      const noCaption = filters.filter((f) => !f.startsWith('subtitles='));
      const fallback = ['-ss', String(state.start), '-i', input, '-t', String(state.end - state.start)];
      if (noCaption.length) fallback.push('-vf', noCaption.join(','));
      fallback.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', standard ? '23' : '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'output.mp4');
      await ffmpeg.exec(fallback);
    }

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data], { type: 'video/mp4' });
    clearOutput();
    state.outputURL = URL.createObjectURL(blob);
    el.output.src = state.outputURL;
    el.outputEmpty.classList.add('hidden');
    el.downloadVideo.classList.remove('hidden');
    el.downloadVideo.dataset.filename = `${safeName(state.file.name.replace(/\.[^.]+$/, ''))}-corte.mp4`;
    progress(100, 'Vídeo pronto');
    if (captionFallback) {
      el.warning.textContent = 'O MP4 foi renderizado, mas o filtro de legenda não está disponível neste build do navegador. Baixe o .SRT separadamente.';
      el.warning.classList.remove('hidden');
    }
    if (!el.postTitle.value.trim()) generateCopy();
  } catch (err) {
    console.error(err);
    el.warning.textContent = `Falha na renderização: ${err?.message || 'erro desconhecido'}. Tente a qualidade rápida, um arquivo menor ou um navegador Chromium atualizado.`;
    el.warning.classList.remove('hidden');
    progress(0, 'Falha na renderização');
  } finally { state.rendering = false; el.render.disabled = false; }
}

el.input.addEventListener('change', (e) => selectFile(e.target.files?.[0]));
el.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); el.dropzone.classList.add('dragover'); });
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('dragover'));
el.dropzone.addEventListener('drop', (e) => { e.preventDefault(); el.dropzone.classList.remove('dragover'); selectFile(e.dataTransfer.files?.[0]); });
el.replace.addEventListener('click', () => el.input.click());
el.rights.addEventListener('change', () => { el.toCut.disabled = !(state.file && el.rights.checked); });

el.source.addEventListener('loadedmetadata', () => {
  state.duration = Number.isFinite(el.source.duration) ? el.source.duration : 0;
  state.start = 0; state.end = Math.min(state.duration, 60);
  el.start.value = state.start.toFixed(1); el.end.value = state.end.toFixed(1); el.start.max = state.duration; el.end.max = state.duration; el.seek.max = state.duration; el.seek.value = 0;
  el.fileMeta.textContent = `${size(state.file.size)} · ${fmt(state.duration)} · ${state.file.type || 'vídeo'}`;
  updateClip();
});
el.source.addEventListener('timeupdate', () => {
  el.seek.value = el.source.currentTime || 0; el.current.textContent = fmt(el.source.currentTime || 0);
  if (el.source.dataset.previewing === 'true' && el.source.currentTime >= state.end) { el.source.pause(); el.source.dataset.previewing = 'false'; }
});
el.seek.addEventListener('input', () => { el.source.currentTime = Number(el.seek.value); });
[el.start, el.end, el.aspect].forEach((x) => x.addEventListener('change', updateClip));
el.setStart.addEventListener('click', () => { el.start.value = (el.source.currentTime || 0).toFixed(1); updateClip(); });
el.setEnd.addEventListener('click', () => { el.end.value = (el.source.currentTime || 0).toFixed(1); updateClip(); });
el.preview.addEventListener('click', async () => { const error = clipError(); if (error) return alert(error); el.source.currentTime = state.start; el.source.dataset.previewing = 'true'; try { await el.source.play(); } catch {} });

el.toCut.addEventListener('click', () => { unlock(2); stage(2); });
el.toCaption.addEventListener('click', () => { const error = clipError(); if (error) return alert(error); unlock(3); stage(3); });
el.toExport.addEventListener('click', () => { refreshSrt(); unlock(4); stage(4); if (!el.postTitle.value) generateCopy(); });
$$('.back').forEach((b) => b.addEventListener('click', () => stage(Number(b.dataset.back))));
$$('[data-stage-button]').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) stage(Number(b.dataset.stageButton)); }));

el.transcribe.addEventListener('click', transcribe);
el.transcript.addEventListener('input', () => { state.chunks = []; refreshSrt(); });
el.burn.addEventListener('change', refreshSrt);
el.downloadSrt.addEventListener('click', () => { refreshSrt(); if (state.srt) download(new Blob([state.srt], { type: 'text/plain;charset=utf-8' }), 'legenda.srt'); });
el.generateCopy.addEventListener('click', generateCopy);
el.copyPost.addEventListener('click', async () => { const text = `${el.postTitle.value.trim()}\n\n${el.postDescription.value.trim()}`.trim(); if (!text) return; try { await navigator.clipboard.writeText(text); el.copyPost.textContent = 'Copiado'; setTimeout(() => { el.copyPost.textContent = 'Copiar texto'; }, 1200); } catch { alert('Não foi possível copiar automaticamente.'); } });
el.render.addEventListener('click', render);
el.downloadVideo.addEventListener('click', async () => { if (!state.outputURL) return; const res = await fetch(state.outputURL); download(await res.blob(), el.downloadVideo.dataset.filename || 'corte.mp4'); });
window.addEventListener('beforeunload', () => { if (state.sourceURL) URL.revokeObjectURL(state.sourceURL); if (state.outputURL) URL.revokeObjectURL(state.outputURL); });
