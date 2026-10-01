'use strict';
// Archivo → Nuevo cancionero: guarda cada canción y el cancionero en su archivo (lo que aún no
// tiene, donde se sugiere), cierra todas las pestañas, pide el nombre del nuevo y abre el panel
// «Colección» para elegir canciones, audios y videos por sus tags.

async function newBookDialog() {
  if (!await saveBeforeClosing('Nuevo cancionero')) return;
  const name = await showModal({
    title: 'Nombre del nuevo cancionero',
    body: `<label class="field"><span>Nombre</span><input type="text" id="nbName" value="Nuevo cancionero" autocomplete="off"></label>
      <p class="hint">Se cierran todas las pestañas. Después eliges en tu colección las canciones, audios y
        videos: se abren en pestañas, en el orden en que los marques. Al guardarlo por primera vez eliges
        dónde queda la lista.</p>`,
    onOpen: d => d.querySelector('#nbName').select(),
    buttons: [
      { label: 'Cancelar' },
      {
        label: 'Crear', primary: true,
        onClick: d => d.querySelector('#nbName').value.trim() || modalFail(d, 'Escribe un nombre para el cancionero.')
      }
    ]
  });
  if (!name) return;
  replaceOrAddTabs([makeDoc({ title: '', text: '' })], true);
  setActiveBook(name);
  setMode('atril');
  refresh();
  openCollection();
}
