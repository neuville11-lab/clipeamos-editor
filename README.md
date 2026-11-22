# ClipLab

Editor local de clips verticales para campañas, publicado como página estática.

## Campañas y briefs

- Crea campañas y cambia entre ellas desde el selector.
- Importa briefs PDF, DOCX o TXT. PDF.js y Mammoth extraen texto en el navegador; no se envía el archivo a un servidor.
- La ficha de requisitos guarda el texto extraído y sus campos en el almacenamiento local del navegador. No guarda el archivo binario original.
- La detección actual usa reglas explícitas para límites, formato, temas, menciones y requisitos. Los campos no reconocidos quedan como «No especificado»; revisa y corrige los resultados antes de trabajar.
- Los PDF escaneados requieren OCR. La carga de PDF/DOCX necesita conexión para descargar los lectores JavaScript desde sus CDN.

## Edición

1. Sube el vídeo desde tu dispositivo.
2. Ajusta inicio, final y encuadre. El clip debe cumplir la duración mínima especificada.
3. La versión local transcribe en el navegador. Studio v2 envía el vídeo al backend solo cuando configuras la URL del servicio e inicias el análisis.
4. Selecciona una pista o crea una base instrumental en el navegador.
5. Exporta y revisa el resultado antes de publicarlo.

Studio v2 reutiliza Whisper Base en un Web Worker local, produce tiempos por palabra y propone cortes al terminar. El vídeo no sale del dispositivo; la primera vez se descarga el modelo desde la CDN. El panel GTA 6 prepara un guion a partir de una duda y datos/fuente que añadas, no consulta tendencias en directo ni sustituye la verificación. El backend remoto queda opcional; la exportación final en Studio v2 sigue pendiente de integración.

## Privacidad

El editor es estático. El vídeo, la música y los documentos se leen localmente en el navegador; el repositorio público contiene solo el código. Las campañas y los textos extraídos se guardan en el almacenamiento local del navegador. No añadas vídeos originales ni exportaciones al repositorio.

