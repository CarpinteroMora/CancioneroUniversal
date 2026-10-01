# Cancionero Universal

Editor y atril de cancioneros con acordes: transposición, diagramas para guitarra, ukelele,
charango y mandolina, audios de referencia por canción, impresión y exportación a
PowerPoint (una lámina por estrofa, pensada para proyectar en la asamblea), Word, OpenDocument,
HTML, texto y Markdown.

## Usarla en línea

**https://carpinteromora.github.io/CancioneroUniversal/**

Funciona en cualquier navegador, también en el celular. Al abrirla por primera vez muestra un
cancionero de ejemplo.

## Instalar la reproducción local (audios de YouTube)

El navegador por sí solo no puede sacar el audio de YouTube, Vimeo, SoundCloud y otras páginas.
En la página web esos audios se abren en YouTube; para escucharlos dentro de la app, el PC necesita
el reproductor local de Cancionero Universal. En la barra de audio, el botón
**«Instalar reproducción en local»** guía todo el proceso:

- **Windows:** descarga
  [CancioneroUniversal-Windows.exe](https://github.com/CarpinteroMora/CancioneroUniversal/releases/latest/download/CancioneroUniversal-Windows.exe)
  y ábrelo con doble clic (no necesita Python). Si Windows muestra «Windows protegió su PC», pulsa
  **Más información** y luego **Ejecutar de todas formas**.
- **Linux y Mac:** abre la Terminal, pega este comando y pulsa Enter (necesita Python 3):

  ```bash
  curl -fsSL https://carpinteromora.github.io/CancioneroUniversal/instalar.sh | bash
  ```

Queda funcionando en segundo plano (también después de reiniciar) y en el menú de aplicaciones.
Luego vuelve a la página y pulsa **Reproducir**; si el navegador pide permiso para acceder a la
red local, acéptalo.

En Android y iPhone no se puede instalar: ahí los videos se abren en la app de YouTube.

### Desde la carpeta descargada

También puedes descargar el repositorio (botón **Code → Download ZIP**), descomprimirlo y abrir la
app con `./iniciar-canciotras.sh` (Linux) o `iniciar-canciotras.bat` (Windows); necesita
[Python 3](https://www.python.org/downloads/).

También crea en el Escritorio la carpeta **Cancionero Universal**, donde se proponen guardar
los archivos exportados.
