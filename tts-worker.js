let synthesizerPromise;
let currentId = null;

async function getSynthesizer() {
  if (!synthesizerPromise) {
    synthesizerPromise = (async () => {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      env.allowLocalModels = false;
      return pipeline('text-to-speech', 'onnx-community/Supertonic-TTS-2-ONNX', {
        dtype: 'q8',
        progress_callback: (info) => {
          if (info.status === 'progress' && Number.isFinite(info.progress)) {
            self.postMessage({ id: currentId, type: 'progress', progress: info.progress, message: info.file || 'Descargando el modelo de voz…' });
          } else if (info.status === 'initiate') {
            self.postMessage({ id: currentId, type: 'progress', message: 'Preparando el modelo de voz en este dispositivo…' });
          }
        },
      });
    })();
    synthesizerPromise.catch(() => { synthesizerPromise = null; });
  }
  return synthesizerPromise;
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'synthesize') return;
  currentId = data.id;
  try {
    const text = String(data.text || '').trim().slice(0, 2400);
    if (!text) throw new Error('Escribe el texto que debe narrar la voz.');
    const voices = ['F1', 'F2', 'M1', 'M2'];
    const voice = voices.includes(data.voice) ? data.voice : 'F1';
    const synth = await getSynthesizer();
    self.postMessage({ id: currentId, type: 'progress', message: 'Generando voz local en español…' });
    const result = await synth(`<es>${text}</es>`, {
      speaker_embeddings: `https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/${voice}.bin`,
      num_inference_steps: 8,
      speed: 1,
    });
    const audio = result.audio instanceof Float32Array ? result.audio : new Float32Array(result.audio);
    self.postMessage({ id: currentId, type: 'result', audio, sampleRate: result.sampling_rate || 44100 }, [audio.buffer]);
  } catch (error) {
    self.postMessage({ id: currentId, type: 'error', message: error?.message || 'No se pudo generar la voz.' });
  } finally {
    currentId = null;
  }
};

