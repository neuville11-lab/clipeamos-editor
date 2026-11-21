# ClipLab Studio v2 — arquitectura propuesta

Esta rama de diseño separa la aplicación de edición del procesamiento pesado. La interfaz es una SPA ligera; los vídeos se quedan en el equipo hasta que el usuario inicia el análisis y confirma el destino.

## Flujo

1. Brief y vídeo entran como un trabajo con identificador propio.
2. API guarda el proyecto y crea una carga firmada a almacenamiento privado.
3. Una cola entrega el trabajo a un worker de vídeo y va publicando progreso.
4. El worker transcribe, puntúa momentos, propone encuadre y genera previsualizaciones.
5. El usuario ajusta clips, subtítulos, música y exporta.
6. El almacenamiento elimina originales y renders según una política de retención configurable.

## Servicios de despliegue

- **Frontend:** GitHub Pages (sin coste de cómputo) o dominio propio en un hosting estático.
- **API y proyectos:** un servicio web pequeño, por ejemplo Railway Hobby, desde 5 USD/mes con 5 USD de uso incluidos. El coste sube con RAM, CPU, tráfico y almacenamiento; no es un coste máximo garantizado.
- **Procesamiento:** workers bajo demanda en Modal, sin pagar GPU inactiva. Su página de precios lista GPU T4 a 0,000164 USD/s y 30 USD de crédito mensual Starter; el coste real depende del modelo, duración, resolución y tiempos de cola.
- **Vídeos:** Cloudflare R2 privado. La tarifa estándar publicada es 0,015 USD/GB-mes y no cobra salida de datos a Internet; operaciones y almacenamiento siguen sujetos a uso.
- **Cola / base de datos:** Redis para trabajos y PostgreSQL para proyectos. No se guarda el binario del vídeo en la base de datos.

Esto permite empezar pequeño y fijar límites por cuenta, tamaño máximo, duración y tiempo de cómputo. Antes de activar cargas en la nube, se decidirán presupuesto, región, acceso y retención. No se incluye una clave de proveedor en el navegador.

## Repositorios compartidos y función

Los repositorios son componentes, bibliotecas o aplicaciones distintas; no se instalarán todos en el frontend. La tabla define una ubicación concreta para cada uno y evita duplicar funciones críticas.

| Repositorio | Uso previsto en ClipLab | Nota de integración |
|---|---|---|
| [AI-Youtube-Shorts-Generator](https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator) | Esqueleto del flujo de detección de destacados y recorte | MIT. Tiene modo local y modo MuAPI; el modo API transmite a un proveedor externo y usa su API key. Se puede envolver como worker, sujeto a revisión de la API y su coste. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Ingesta opcional de URL autorizada | No se activa por defecto; validar host, URL, permisos y condiciones del origen. En la web, priorizar la carga del archivo del usuario. |
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | Editor avanzado externo o referencia de línea de tiempo | MIT. El repositorio principal declara que está siendo reescrito; su versión Classic es la disponible hoy. No es una librería de recorte para insertar en el backend. |
| [OpenCV](https://github.com/opencv/opencv) | Detector de sujeto y encuadre vertical | Apache-2.0. Worker CPU/GPU; suavizar el recorte para evitar saltos. |
| [OBS Studio](https://github.com/obsproject/obs-studio) | Captura en directo del usuario | GPL-2.0; aplicación independiente, no un procesador de episodios subidos. |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | Lectura, previsualización y tareas ligeras en el navegador | MPL-2.0; no sustituye al worker de servidor para render pesado. |
| [Whisper](https://github.com/openai/whisper) | Alternativa ASR de servidor | MIT; requiere cómputo proporcional al tamaño del modelo. |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | ASR local/CPU y alternativa cuantizada | MIT; puede ejecutarse como worker nativo. |
| [stable-ts](https://github.com/jianfch/stable-ts) | Refinamiento de tiempos por palabra | MIT, pero el repositorio aparece archivado; opcional y fijado a una versión si se usa. |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | Diarización: quién habla y cuándo | La licencia del código no determina la licencia ni el acceso de cada modelo. Revisar ambas antes de activar. |
| [Supervision](https://github.com/roboflow/supervision) | Utilidades para detecciones y anotaciones | MIT; complemento a OpenCV, no motor de detección por sí mismo. |
| [Norfair](https://github.com/tryolabs/norfair) | Seguir sujetos entre fotogramas | BSD-3-Clause; opcional si OpenCV pierde al sujeto. |
| [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | Reducción de ruido de voz | El metadato de GitHub no declara un SPDX; revisar el archivo LICENSE del commit que se integre. |
| [Demucs](https://github.com/facebookresearch/demucs) | Separar voces y música cuando convenga | MIT, pero archivado; fase opcional, pesada en GPU. |
| [pysubs2](https://github.com/tkarabela/pysubs2) | Crear/editar SRT y ASS | MIT; utilidades de subtítulos del worker. |
| [libass](https://github.com/libass/libass) | Renderizar subtítulos ASS con tipografía y contorno | ISC; integrar mediante FFmpeg en el worker de render. |
| [Editly](https://github.com/mifi/editly) | Composición declarativa de vídeo | MIT; elegirlo o FFmpeg para ensamblado, no duplicar pipelines. |
| [Kdenlive](https://github.com/KDE/kdenlive) | Edición manual avanzada fuera de ClipLab | GPL-3.0; aplicación independiente, opcional para un flujo de exportación de proyecto. |
| [Shotcut](https://github.com/mltframework/shotcut) | Edición manual alternativa | GPL-3.0; aplicación independiente; su base MLT se solapa con otros renders. |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | Reescalado opcional de fotogramas | BSD-3-Clause; no entra en el render estándar para controlar coste/tiempo. |
| [RIFE](https://github.com/hzwer/ECCV2022-RIFE) | Interpolación de fotogramas opcional | MIT; requiere GPU y no se necesita para un clip social estándar. |
| [PyAV](https://github.com/PyAV-Org/PyAV) | Decodificación/lectura de medios en Python | BSD-3-Clause; alternativa de acceso a FFmpeg desde Python. |

## Seguridad, derechos y licencias

- Los vídeos se tratan como entrada no confiable. Validar tamaño, duración, contenedor, códec, URL de origen y rutas; nunca aceptar `file://` ni rutas del usuario desde una API pública.
- El trabajo debe incluir autorización explícita antes de enviar el vídeo a un proveedor externo. Las URLs de YouTube no implican derecho de descarga ni de reutilización.
- Las licencias de código y las licencias/políticas de los pesos son distintas. Mantener un inventario de atribuciones y fijar commit/versiones para cada componente.
- OBS, Kdenlive y Shotcut son programas completos con licencias copyleft; se mantienen externos al servicio web. El render principal será un worker aislado.
- Los artefactos de nube son privados por defecto, con URL firmada de corta duración, límite de tamaño y borrado automático.

## Estado de esta maqueta

La interfaz visual en `index.html` presenta el flujo nuevo y la configuración de backend. El contrato HTTP previsto es `GET /health`, `POST /v1/jobs` (multipart: vídeo, brief y lenguaje) y `GET /v1/jobs/{id}`. El worker y el almacenamiento todavía requieren elegir proveedor y conectar credenciales mediante secretos del servicio; no simular respuestas en la UI.

## Fuentes de precios consultadas (21-11-2026)

- [Modal pricing](https://modal.com/pricing)
- [Railway pricing plans](https://docs.railway.com/pricing/plans)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)

