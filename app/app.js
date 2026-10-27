const $ = (id) => document.getElementById(id);
let stops = [];

function normalise(value) { return value.trim().replace(/\s+/g, ' ').replace(/[，]/g, ','); }
function key(value) { return normalise(value).toLocaleLowerCase('ro'); }
function distance(a, b) {
  const rad = Math.PI / 180, x = (b.lon - a.lon) * rad * Math.cos((a.lat + b.lat) * rad / 2), y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

function refreshSelectors() {
  for (const id of ['start', 'finish']) {
    const select = $(id), old = select.value;
    select.innerHTML = id === 'start' ? '<option value="">Prima adresă introdusă</option>' : '<option value="">Ultima oprire optimizată</option>';
    stops.forEach((stop, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${stop.address}`; select.append(option); });
    select.value = old;
  }
  $('status').textContent = `${stops.length} adrese`;
}

function render() {
  const list = $('route'); list.replaceChildren();
  stops.forEach((stop, index) => { const item = document.createElement('li'); item.textContent = `${index + 1}. ${stop.address}`; list.append(item); });
  $('summary').textContent = stops.length ? `${stops.length} opriri` : '—';
  refreshSelectors();
}

function addAddresses() {
  const incoming = $('addresses').value.split(/\r?\n|\t/).map(normalise).filter(Boolean);
  const seen = new Set(stops.map((stop) => key(stop.address))); let added = 0;
  for (const address of incoming) if (!seen.has(key(address))) { stops.push({ address }); seen.add(key(address)); added++; }
  $('addresses').value = ''; $('notice').className = 'notice ok'; $('notice').textContent = `${added} adrese adăugate. Duplicatele au fost ignorate.`; render();
}

function optimize() {
  if (stops.length < 2) return;
  const start = $('start').value === '' ? 0 : Number($('start').value);
  const finish = $('finish').value === '' ? null : Number($('finish').value);
  if (finish !== null && finish === start && stops.length > 1) { $('notice').className = 'notice error'; $('notice').textContent = 'Plecare și final trebuie să fie adrese diferite.'; return; }
  const chosen = stops.map((stop, index) => ({ ...stop, originalIndex: index }));
  const result = [chosen.splice(start, 1)[0]];
  const final = finish === null ? null : chosen.splice(chosen.findIndex((stop) => stop.originalIndex === finish), 1)[0];
  while (chosen.length) {
    const current = result[result.length - 1];
    let best = 0, bestDistance = Infinity;
    for (let i = 0; i < chosen.length; i++) if (current.lat != null && chosen[i].lat != null) { const d = distance(current, chosen[i]); if (d < bestDistance) { best = i; bestDistance = d; } }
    result.push(chosen.splice(best, 1)[0]);
  }
  if (final) { const index = result.findIndex((stop) => stop.address === final.address); result.splice(index, 1); result.push(final); }
  stops = result; render(); $('notice').className = 'notice ok'; $('notice').textContent = 'Ordinea a fost calculată local. Când pachetul de hartă este instalat, optimizarea folosește coordonatele reale.';
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
$('add').addEventListener('click', addAddresses); $('optimize').addEventListener('click', optimize); $('clear').addEventListener('click', () => { stops = []; render(); }); render();
