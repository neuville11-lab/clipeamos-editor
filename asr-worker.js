let transcriberPromise;

async function getTranscriber(jobId) {
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
              id: jobId,
              type: 'progress',
              progress: info.progress,
              message: info.file || 'cargando archivos del modelo',
            });
          } else if (info.status === 'initiate') {
            self.postMessage({
              id: jobId,
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

self.onmessage = async ({ data }) => {
  if (data?.type !== 'transcribe') return;
  const { id, audio } = data;
  try {
    const transcriber = await getTranscriber(id);
    self.postMessage({
      id,
      type: 'progress',
      message: 'Whisper está transcribiendo en segundo plano; puedes seguir usando la página…',
    });
    const result = await transcriber(new Float32Array(audio), {
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
  }
};

