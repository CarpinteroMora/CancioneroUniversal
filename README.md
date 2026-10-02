# Cancionero Universal

Editor y atril de cancioneros con acordes: transposición, diagramas para guitarra, ukelele,
charango y mandolina, audios de referencia por canción, impresión y exportación a
PowerPoint (una lámina por estrofa, pensada para proyectar en la asamblea), Word, OpenDocument,
HTML, texto y Markdown.

## Usarla en línea

**https://carpinteromora.github.io/CancioneroUniversal/**

Funciona en cualquier navegador, también en el celular. Al abrirla por primera vez muestra un
cancionero de ejemplo.

## Nuevo cancionero

El nombre del cancionero activo se ve junto al título (📒); un punto naranja indica cambios sin
guardar y el borde punteado, que todavía no tiene archivo. Un clic lo guarda.

*Archivo → Nuevo cancionero…* cierra todas las pestañas, pero antes guarda cada canción con cambios
en su propio archivo y el cancionero en su lista .m3u8. Lo que aún no tiene archivo se guarda en la
carpeta que se sugiere (la del cancionero o tu carpeta de canciones; se puede cambiar), y la lista
nueva pregunta dónde guardarse. Luego pide el nombre del nuevo cancionero y abre la **colección**.
Al terminar, *Guardar cancionero*: la primera vez eliges dónde (dentro de tu carpeta de canciones);
después se guarda siempre en el mismo archivo (*Guardar cancionero como…* para cambiarlo).

## Colección

*Archivo → Abrir colección…* (Ctrl+Alt+O) abre un panel flotante con todo lo que hay en las carpetas
que eliges: canciones (.md), audios y videos. Puedes añadir varias carpetas (tu carpeta de canciones,
Música, Videos, o las que se sincronizan con Drive, OneDrive o tus otros equipos), o soltarlas sobre el
panel. La marcada con ⭐ es donde se guardan las canciones nuevas y los cancioneros.

Se filtra por tipo (canciones, audios, videos), por **tags** o por título, y cada casilla que marcas
abre eso en una pestaña (desmarcarla la cierra): así armas, por ejemplo, una misa o una presentación
solo de cuecas o tonadas. Los tags de las canciones vienen de su .md; los de un audio o video juntan
los de las canciones que lo usan, el género que traiga el archivo (mp3) y los que le pongas con 🏷️,
que se guardan en `cancionero-etiquetas.json` dentro de esa carpeta para que viajen con ella.

## Compartir por WhatsApp

*Archivo → Compartir cancionero (WhatsApp)…* prepara el cancionero en versión **liviana**: letras, acordes,
tags, instrumentos, rasgueos y los audios y partituras de internet (los archivos de tu equipo no viajan).
Se puede enviar de dos formas:

- **Archivo .html** (en WhatsApp, como Documento): se ve en cualquier navegador, con tono, modo noche y
  desplazamiento, y trae el botón **«Editar en Cancionero Universal»**.
- **Enlace**: al tocarlo se abre la app directamente con el cancionero.

Quien lo recibe lo tiene en pestañas listas para editar; con *Archivo → Guardar cancionero* quedan las
canciones (.md) y la lista (.m3u8) en su carpeta. El .html también se abre con *Archivo → Abrir*, y todas
las páginas exportadas como .html traen el mismo botón para editarlas en la app.

## Modo noche

En el atril, el botón **🌙** (o *Ver → Modo noche*, Ctrl+Alt+D) pone fondo negro, letra blanca y acordes
en amarillo, muy contrastados, para que la pantalla no deslumbre en un escenario. **☀️** vuelve al modo día.
Las páginas HTML exportadas traen el mismo botón y recuerdan la elección.

## Grabar

*Herramientas → Grabar…* abre una grabadora: canta o toca, detén y guarda. La toma queda como `.webm`
en la carpeta `audios` de tu carpeta de canciones (se puede cambiar) y se vincula a la canción abierta.
Para que no quede ni muy baja ni reventada, el sonido pasa por un **nivel automático** (sube lo que
suena bajito y baja lo que suena fuerte; se puede apagar), una ganancia de entrada ajustable y un
**limitador** que no deja pasar ningún pico de -1 dB. La barra de nivel avisa si el micrófono satura o
si llega muy bajo. El audio se guarda tal cual: si quieres editarlo, ábrelo con tu propio editor.

## En el teléfono y la tablet

La app se adapta a la pantalla: menú **☰**, botón **🎼 Tono** que abre las notas en una hoja abajo,
letra que se **ajusta al ancho** (botón **↔**), barra del atril abajo y paso de una canción a otra
**deslizando el dedo** hacia los lados. En el atril la pantalla no se apaga.

Se puede **instalar como aplicación** y así funciona también **sin internet**:

- **Android (Chrome):** menú **⋮ → Instalar aplicación**, o el aviso «Instalar» que aparece abajo.
- **iPhone y iPad (Safari):** botón **Compartir (□↑) → Agregar a inicio**.
- **Computador (Chrome o Edge):** ícono **Instalar** al final de la barra de direcciones.

También desde la app: *Acerca de → Instalar app en este dispositivo…*. Cuando hay internet se
carga siempre la versión más nueva.

## Ayúdanos a seguir trabajando

Cancionero Universal es gratuito. Si te es útil y quieres colaborar económicamente para que sigamos
desarrollándolo, escríbenos a **cancionerolitugico@gmail.com** (o desde la app: *Acerca de →
Ayúdanos a seguir trabajando*) y te enviaremos nuestros datos para transferencias.
¡Gracias, y que Dios les bendiga por su ayuda!

## Instalar la reproducción local (audios de YouTube)

El navegador por sí solo no puede sacar el audio de YouTube, Vimeo, SoundCloud y otras páginas.
En la página web esos audios se abren en YouTube; para escucharlos dentro de la app, el PC necesita
el reproductor local de Cancionero Universal. En la barra de audio, el botón
**«▶ Reproducir aquí»** guía todo el proceso:

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

En Android, iPhone y tablets no hace falta instalar nada: los videos de YouTube suenan en una
**mini ventana dentro de la app** (se puede mover, agrandar y cambiar la velocidad), así la
canción sigue a la vista. YouTube pide que el video se vea, por eso la ventana no se puede ocultar.

### Desde la carpeta descargada

También puedes descargar el repositorio (botón **Code → Download ZIP**), descomprimirlo y abrir la
app con `./iniciar-canciotras.sh` (Linux) o `iniciar-canciotras.bat` (Windows); necesita
[Python 3](https://www.python.org/downloads/).

También crea en el Escritorio la carpeta **Cancionero Universal**, donde se proponen guardar
los archivos exportados.
