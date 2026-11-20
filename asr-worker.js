let transcriberPromise;
let currentJobId = null;
let queue = Promise.resolve();

function reportProgress(message, progress) {
  self.postMessage({ id: currentJobId, type: 'progress', message, progress });
}

async function extractMono16k(file) {
  const { AudioSampleSink, ALL_FORMATS, BlobSource, Input } = await import(
    'https://cdn.jsdelivr.net/npm/mediabunny@1.66.2/+esm'
  );
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('El vídeo no contiene una pista de audio.');
    if (!await track.canDecode()) {
      throw new Error('El navegador no puede decodificar el audio de este vídeo.');
    }
    const end = Math.ceil(await track.computeDuration());
    const first = Math.max(0, await track.getFirstTimestamp());
    const audio = new Float32Array(Math.ceil(Math.max(0, end - first) * 16000) + 16000);
    const sink = new AudioSampleSink(track);
    let copied = 0;
    let sampleCount = 0;
    for await (const sample of sink.samples()) {
      try {
        const rateRatio = sample.sampleRate / 16000;
        const start = Math.max(0, Math.round((sample.timestamp - first) * 16000));
        const outputFrames = Math.min(Math.ceil(sample.numberOfFrames / rateRatio), audio.length - start);
        const planes = Array.from({ length: sample.numberOfChannels }, (_, channelIndex) => {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, { format: 'f32-planar', planeIndex: channelIndex });
          return plane;
        });
        for (let i = 0; i < outputFrames; i++) {
          const position = i * rateRatio;
          const left = Math.floor(position);
          const fraction = position - left;
          let mono = 0;
          for (const plane of planes) {
            const a = plane[left] || 0;
            const b = plane[Math.min(left + 1, plane.length - 1)] || 0;
            mono += (a + (b - a) * fraction) / planes.length;
          }
          audio[start + i] = mono;
        }
        copied += outputFrames;
      } finally {
        sample.close();
      }
      sampleCount++;
      if (sampleCount % 64 === 0) {
        reportProgress(`Extrayendo audio local · ${Math.min(100, Math.round(copied / Math.max(1, audio.length) * 100))}%`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (!copied) throw new Error('No se pudieron extraer muestras de audio del vídeo.');
    return audio.subarray(0, Math.min(audio.length, copied + 16000));
  } finally {
    input.dispose();
  }
}

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { env, pipeline } = await import(
        'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1'
      );
      env.allowLocalModels = false;
      return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q8',
        progress_callback: (info) => {
          if (info.status === 'progress' && Number.isFinite(info.progress)) {
            self.postMessage({
              id: currentJobId,
              type: 'progress',
              progress: info.progress,
              message: info.file || 'cargando archivos del modelo',
            });
          } else if (info.status === 'initiate') {
            self.postMessage({
              id: currentJobId,
              type: 'progress',
              message: 'Preparando el modelo Whisper en segundo plano…',
            });
          }
        },
      });
    })();
    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

async function runTranscription({ id, file }) {
  currentJobId = id;
  try {
    const audio = await extractMono16k(file);
    reportProgress('Audio listo · cargando Whisper en segundo plano…');
    const transcriber = await getTranscriber();
    reportProgress('Whisper está transcribiendo en segundo plano; puedes seguir usando la página…');
    const result = await transcriber(audio, {
      sampling_rate: 16000,
      language: 'spanish',
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ id, type: 'result', chunks: result.chunks || [] });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error?.message || 'Error inesperado en el worker de voz.',
    });
  } finally {
    currentJobId = null;
  }
}

self.onmessage = ({ data }) => {
  if (data?.type !== 'transcribe') return;
  queue = queue.then(() => runTranscription(data));
};

