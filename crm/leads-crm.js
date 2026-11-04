// ============================================================
//  CRM · Leads ("Avisame cuando entra" de ofertas.html)
//  Los lee el servidor (acción leads_list, con la clave secreta de Supabase): desde el
//  navegador nadie puede leer la tabla. Filtros por fecha, categoría y campaña (utm_campaign),
//  ventas que llegaron por cada campaña y exportación para la lista de difusión de WhatsApp.
// ============================================================
let _leads = [];
let _leadsFiltrados = [];

async function loadLeads(force = false) {
  const cont = $('leads-tabla');
  if (!cont) return;
  if (!force && _leads.length) { pintarLeads(); return; }
  cont.innerHTML = uiCargando(6);
  try {
    // Los pedidos se piden a la vez (para contar las ventas por campaña); si fallan, igual se ven los leads
    const pedidos = _pedidos.length ? null : crm({ action: 'ext_pedidos_listar' }).catch(() => null);
    const res = sinError(await crm({ action: 'leads_list' }));
    _leads = Array.isArray(res.rows) ? res.rows : [];
    if (pedidos) { const raw = await pedidos; if (Array.isArray(raw) && !_pedidos.length) _pedidos = [...raw].reverse(); }
    llenarFiltrosLeads();
    pintarLeads();
  } catch (e) {
    cont.innerHTML = uiError(e.message, 'loadLeads(true)');
  }
}

function llenarFiltrosLeads() {
  const opciones = (sel, valores, todos) => {
    const el = $(sel), actual = el.value;
    el.innerHTML = `<option value="">${todos}</option>` +
      valores.map(v => `<option value="${hx(v)}">${hx(v)}</option>`).join('');
    if (valores.includes(actual)) el.value = actual;
  };
  const cats = [...new Set(_leads.flatMap(l => l.categorias || []))].sort((a, b) => a.localeCompare(b, 'es'));
  const camps = [...new Set(_leads.map(l => l.utm_campaign).filter(Boolean))].sort();
  opciones('leads-cat', cats, 'Todas las categorías');
  opciones('leads-camp', camps, 'Todas las campañas');
  if (_leads.some(l => !l.utm_campaign)) $('leads-camp').insertAdjacentHTML('beforeend', '<option value="__sin">Sin campaña</option>');
}

function _leadsAplicarFiltros() {
  const desde = $('leads-desde').value, hasta = $('leads-hasta').value;
  const cat = $('leads-cat').value, camp = $('leads-camp').value;
  const q = $('leads-buscar').value.trim().toLowerCase();
  return _leads.filter(l => {
    const dia = String(l.actualizado || l.creado || '').slice(0, 10);
    if (desde && dia < desde) return false;
    if (hasta && dia > hasta) return false;
    if (cat && !(l.categorias || []).includes(cat)) return false;
    if (camp === '__sin' ? l.utm_campaign : camp && l.utm_campaign !== camp) return false;
    if (q && !(String(l.nombre || '').toLowerCase().includes(q) || String(l.whatsapp || '').includes(q.replace(/\D/g, '') || '~'))) return false;
    return true;
  });
}

// Pedidos que llegaron con utm_campaign (los graba el checkout): cuántos y cuánto por campaña
function _ventasPorCampana() {
  const por = {};
  (_pedidos || []).forEach(p => {
    const c = (String(p.utm || '').match(/(?:^|&)utm_campaign=([^&]+)/) || [])[1];
    if (!c) return;
    const k = decodeURIComponent(c);
    por[k] = por[k] || { n: 0, total: 0 };
    por[k].n++; por[k].total += Number(p.total) || 0;
  });
  return por;
}

function _waLead(l) { return 'https://wa.me/' + String(l.whatsapp || '').replace(/\D/g, '') +
  '?text=' + encodeURIComponent('Hola ' + (l.nombre || '') + '! Te escribimos de Virtual Shop Baires: entró mercadería' +
  ((l.categorias || []).length ? ' de ' + l.categorias.join(', ') : '') + '. Mirá lo que llegó: https://virtualshopbaires.com.ar/ofertas.html'); }
function _telLindo(w) { const d = String(w || ''); return d.startsWith('549') ? '+54 9 ' + d.slice(3, 5) + ' ' + d.slice(5, 9) + '-' + d.slice(9) : d; }

function pintarLeads() {
  const cont = $('leads-tabla');
  const lista = _leadsFiltrados = _leadsAplicarFiltros();
  const semana = Date.now() - 7 * 864e5;
  const nuevos = lista.filter(l => Date.parse(l.creado) > semana).length;
  const ventas = _ventasPorCampana();
  const camp = $('leads-camp').value;
  const vSel = camp && camp !== '__sin' ? ventas[camp] : null;
  const vTodas = Object.values(ventas).reduce((a, v) => ({ n: a.n + v.n, total: a.total + v.total }), { n: 0, total: 0 });
  const v = vSel || (camp ? null : vTodas);
  $('leads-resumen').innerHTML = `
    <div class="leads-dato"><strong>${lista.length}</strong><span>leads${lista.length !== _leads.length ? ' (de ' + _leads.length + ')' : ''}</span></div>
    <div class="leads-dato"><strong>${nuevos}</strong><span>nuevos en 7 días</span></div>
    <div class="leads-dato"><strong>${v ? v.n : 0}</strong><span>ventas ${camp && camp !== '__sin' ? 'de «' + hx(camp) + '»' : 'con campaña'}${v && v.total ? ' · ' + fmtMoney(v.total) : ''}</span></div>`;
  $('leads-exportar').disabled = $('leads-copiar').disabled = !lista.length;

  if (!_leads.length) {
    cont.innerHTML = uiVacio('fa-user-plus', 'Todavía no hay leads', 'Cuando alguien deje su WhatsApp en «Avisame cuando entra» de ofertas.html, aparece acá.', { texto: 'Ver la página de ofertas', onclick: "window.open('https://virtualshopbaires.com.ar/ofertas.html','_blank')" });
    return;
  }
  if (!lista.length) {
    cont.innerHTML = uiVacio('fa-filter', 'Ningún lead con esos filtros', 'Probá con otra fecha, categoría o campaña.', { texto: 'Quitar filtros', onclick: 'limpiarFiltrosLeads()' });
    return;
  }
  cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Nombre</th><th>WhatsApp</th><th>Le interesa</th><th>Vino de</th></tr></thead>
      <tbody>
        ${lista.map(l => `
          <tr>
            <td>${fmtFecha(l.actualizado || l.creado)}${l.veces > 1 ? `<div class="text-muted" style="font-size:.78rem">${l.veces} veces</div>` : ''}</td>
            <td><strong>${hx(l.nombre || '—')}</strong></td>
            <td><a href="${hx(_waLead(l))}" target="_blank" rel="noopener" class="btn-secondary btn-sm" style="text-decoration:none;white-space:nowrap"><i class="fa-brands fa-whatsapp"></i> ${hx(_telLindo(l.whatsapp))}</a></td>
            <td>${(l.categorias || []).map(c => `<span class="leads-cat">${hx(c)}</span>`).join(' ') || '<span class="text-muted">—</span>'}</td>
            <td>${l.utm_campaign || l.utm_source ? `${hx(l.utm_source || '')}${l.utm_campaign ? ' · <strong>' + hx(l.utm_campaign) + '</strong>' : ''}` : '<span class="text-muted">directo</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function limpiarFiltrosLeads() {
  ['leads-desde', 'leads-hasta', 'leads-cat', 'leads-camp', 'leads-buscar'].forEach(id => { $(id).value = ''; });
  pintarLeads();
}

// CSV para importar en Google Contactos (los números agendados entran a la lista de difusión)
function exportarLeads() {
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = [['First Name', 'Phone 1 - Label', 'Phone 1 - Value', 'Labels', 'Notes']].concat(_leadsFiltrados.map(l => [
    l.nombre, 'Mobile', '+' + String(l.whatsapp || '').replace(/\D/g, ''), 'VSB Leads',
    [(l.categorias || []).join(', '), l.utm_campaign ? 'campaña: ' + l.utm_campaign : '', 'alta: ' + String(l.creado || '').slice(0, 10)].filter(Boolean).join(' | ')
  ]));
  const csv = '﻿' + filas.map(f => f.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'leads-vsb-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(_leadsFiltrados.length + ' contactos exportados');
}

async function copiarNumerosLeads() {
  const txt = _leadsFiltrados.map(l => '+' + String(l.whatsapp || '').replace(/\D/g, '')).join('\n');
  try { await navigator.clipboard.writeText(txt); toast(_leadsFiltrados.length + ' números copiados'); }
  catch (e) { toast('No se pudo copiar', 'err'); }
}
