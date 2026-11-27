// ============================================================
//  Datos del cliente en un pedido — compartido por panel.html y panel-ops.html
//  WhatsApp directo al chat, dirección de envío y cada dato con su botón de copiar.
// ============================================================

// Número para wa.me: Argentina con 549 + característica + número (sin 0 ni 15)
function telWhatsApp(t) {
  let d = String(t || '').replace(/\D/g, '').replace(/^00/, '');
  if (!d) return '';
  const original = d;
  if (d.startsWith('54')) d = d.slice(2);
  d = d.replace(/^0/, '');
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1);
  if (d.length === 12) {
    for (let a = 2; a <= 4; a++) if (d.substr(a, 2) === '15') { d = d.slice(0, a) + d.slice(a + 2); break; }
  }
  return d.length === 10 ? '549' + d : original;
}

function _datosPedido(p) {
  const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.cliente || '';
  let calle = '', zona = '';
  if (p.calle) {
    calle = p.calle + (p.numeroCalle ? ' ' + p.numeroCalle : '') + (p.piso ? ', piso/depto ' + p.piso : '');
    zona = [p.localidad, p.provincia].filter(Boolean).join(', ') + (p.cp ? ' (CP ' + p.cp + ')' : '');
  } else if (p.direccion) {
    calle = String(p.direccion);
  }
  const ref = p.orderNumber || p.id || '';
  return {
    nombre, ref,
    campos: [
      ['Nombre', nombre],
      ['Teléfono', p.telefono || ''],
      ['DNI', p.dni || ''],
      ['Email', p.email || ''],
      ['Dirección', calle],
      ['Ciudad', zona],
      ['Cómo lo recibe', p.metodoEntrega || ''],
      ['Nota del cliente', p.obs || ''],
    ].filter(c => String(c[1]).trim()),
  };
}

// Texto para pegar en el envío o en un mensaje
function _textoPedido(p) {
  const d = _datosPedido(p);
  return d.campos.map(c => c[0] + ': ' + c[1])
    .concat(d.ref ? ['Pedido: ' + d.ref] : [], p.productos ? ['Productos: ' + p.productos] : [])
    .join('\n');
}

function pedidoContactoHTML(p) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = _datosPedido(p);
  const wa = telWhatsApp(p.telefono);
  const primer = (d.nombre.split(/\s+/)[0] || '').replace(/^./, c => c.toUpperCase());
  const msg = `Hola ${primer}! Te escribimos de Virtual Shop Baires por tu pedido${d.ref ? ' ' + d.ref : ''}.`;
  const sinDir = !d.campos.some(c => c[0] === 'Dirección');
  const envio = /env[ií]o/i.test((p.metodoEntrega || '') + ' ' + (p.productos || ''));
  const filas = d.campos.map(([k, v]) => `
      <div class="pc-fila">
        <span class="pc-k">${esc(k)}</span>
        <span class="pc-v">${esc(v)}</span>
        <button type="button" class="pc-copiar" data-copiar="${esc(v)}" aria-label="Copiar ${esc(k.toLowerCase())}"><i class="fa-regular fa-copy" aria-hidden="true"></i><span>Copiar</span></button>
      </div>`).join('');
  return `<div class="pc-bloque" onclick="event.stopPropagation()">
      <div class="pc-acciones">
        ${wa ? `<a class="pc-btn pc-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Escribirle por WhatsApp</a>` : ''}
        <button type="button" class="pc-btn pc-todo" data-copiar="${esc(_textoPedido(p))}"><i class="fa-regular fa-clipboard" aria-hidden="true"></i> Copiar todo</button>
      </div>
      ${p.direccionDeFicha ? '<p class="pc-aviso">Esta dirección la sacamos de su ficha. Confirmala con el cliente antes de enviar.</p>' : ''}
      ${sinDir && envio ? '<p class="pc-aviso">Falta la dirección. Pedísela por WhatsApp.</p>' : ''}
      <div class="pc-lista">${filas}</div>
    </div>`;
}

async function _copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const a = document.createElement('textarea');
    a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(a); a.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
    a.remove();
    return ok;
  }
}

document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('.pc-bloque [data-copiar]');
  if (!b) return;
  e.preventDefault();
  const ok = await _copiarTexto(b.dataset.copiar);
  if (typeof toast === 'function') toast(ok ? (b.classList.contains('pc-todo') ? 'Copiado todo ✓ Ya lo podés pegar' : 'Copiado ✓') : 'No se pudo copiar', ok ? 'ok' : 'err');
  if (ok) {
    // El botón dice "Copiado" un ratito: se ve qué se copió
    const txt = b.querySelector('span'), antes = txt ? txt.textContent : '';
    b.classList.add('pc-ok'); if (txt) txt.textContent = 'Copiado';
    setTimeout(() => { b.classList.remove('pc-ok'); if (txt) txt.textContent = antes; }, 1400);
  }
}, true);   // en captura: el bloque frena el clic para que no se cierre la tarjeta

// ─── Productos del pedido con su foto ─────────────────────────
// Lee «1x Nombre · Color, 2x Otro» (o el formato viejo en JSON) y busca la foto en la lista de productos del CRM
function _itemsPedido(p) {
  const t = String(p.productos || p.detalle || '').trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try { return JSON.parse(t).map(i => ({ cant: Number(i.qty || i.cantidad) || 1, nombre: String(i.nombre || '').trim(), variante: [i.color, i.talle].filter(Boolean).join(' / ') })); } catch (e) { return []; }
  }
  return t.split(/,\s*(?=\d+\s*x\s)/i).map(s => {
    const m = s.trim().replace(/,\s*Env[ií]o.*$/i, '').match(/^(\d+)\s*x\s+(.+)$/i);
    if (!m) return null;
    const [nombre, ...resto] = m[2].split(' · ');
    return { cant: +m[1], nombre: nombre.trim(), variante: resto.join(' · ').trim() };
  }).filter(Boolean);
}
function _fotoItem(it) {
  const lista = typeof _productos !== 'undefined' && Array.isArray(_productos) ? _productos : [];
  const n = it.nombre.toLowerCase();
  const mismos = lista.filter(x => String(x.nombre || '').trim().toLowerCase() === n);
  if (!mismos.length) return '';
  const color = it.variante.split(' / ')[0].trim().toLowerCase();
  const v = (color && mismos.find(x => String(x.color || '').trim().toLowerCase() === color && x.imagen)) || mismos.find(x => x.imagen) || {};
  return v.imagen || mismos[0].fotoProducto || '';
}
function productosPedidoHTML(p) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const items = _itemsPedido(p);
  if (!items.length) return p.productos ? `<div style="flex-basis:100%"><span class="ped-label">Productos:</span> ${esc(p.productos)}</div>` : '';
  return `<div class="ped-items">${items.map(it => {
    const foto = _fotoItem(it);
    const img = typeof prodThumb === 'function' ? prodThumb(foto, 56)
      : foto ? `<img class="prod-thumb" src="${esc(foto)}" alt="" loading="lazy" style="width:56px;height:56px">` : '';
    return `<div class="ped-item">${img}<div class="ped-item-txt"><b>${it.cant}× ${esc(it.nombre)}</b>${it.variante ? `<small>${esc(it.variante)}</small>` : ''}</div></div>`;
  }).join('')}</div>`;
}

// Momento del pedido en milisegundos (para ordenar: el más nuevo arriba)
function tiempoPedido(p) {
  const t = String((p && (p.timestamp || p.fecha)) == null ? '' : (p.timestamp || p.fecha)).trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  const d = m ? new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : new Date(t.replace(' ', 'T'));
  return t && !isNaN(d) ? d.getTime() : 0;
}

// Fecha con hora: «26/11/2026 · 14:35 hs»
function fechaHoraPedido(s) {
  const t = String(s == null ? '' : s).trim();
  let d = null, m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (m) d = new Date(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  else if (t) d = new Date(t.replace(' ', 'T'));
  if (!d || isNaN(d)) return t || '—';
  const hora = /\d{1,2}:\d{2}/.test(t) ? ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' hs' : '';
  return d.toLocaleDateString('es-AR') + hora;
}
