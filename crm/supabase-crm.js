// ============================================================
//  CRM · Productos en Supabase
//  Se carga después de panel(.ops).js y productos-crm.js. Cuando
//  CRM_PRODUCTOS_EN_SUPABASE es true, las acciones de productos dejan de ir
//  a Apps Script/planilla y van directo a Supabase (mucho más rápido), con
//  la sesión de un usuario admin de Supabase Auth. El resto del CRM no cambia.
// ============================================================

const CRM_PRODUCTOS_EN_SUPABASE = false;
const SB_CRM_URL = 'https://dtsixnqwwrbwybulpuxo.supabase.co';
const SB_CRM_PUB = 'sb_publishable_nGmdSmwKGuiF5LG9fbA8dw_auHYFgCM';   // pública; los permisos los da el usuario admin

let _sbCli = null;
function sbCliente() {
  if (!_sbCli) _sbCli = window.supabase.createClient(SB_CRM_URL, SB_CRM_PUB, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vsb-crm-supabase' }
  });
  return _sbCli;
}

function _esAdmin(session) {
  return !!(session && session.user && session.user.app_metadata && session.user.app_metadata.role === 'admin');
}

// Pide email y contraseña del admin una sola vez; la sesión queda guardada en este dispositivo.
let _sbLoginPromesa = null;
async function sbAsegurarLogin() {
  const { data } = await sbCliente().auth.getSession();
  if (_esAdmin(data.session)) return true;
  if (_sbLoginPromesa) return _sbLoginPromesa;
  _sbLoginPromesa = new Promise((resolve, reject) => {
    document.getElementById('sb-login')?.remove();
    const m = document.createElement('div');
    m.id = 'sb-login';
    m.className = 'modal-backdrop';
    m.style.display = 'flex';
    m.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header"><h3>Entrar a los productos</h3></div>
        <div class="modal-body">
          <p class="text-muted" style="margin:0 0 12px;font-size:.85rem">Usuario administrador de la base de datos. Se pide una sola vez en este dispositivo.</p>
          <label class="form-label" for="sb-email">Email</label>
          <input class="form-input" id="sb-email" type="email" autocomplete="username">
          <label class="form-label" for="sb-pass" style="margin-top:10px">Contraseña</label>
          <input class="form-input" id="sb-pass" type="password" autocomplete="current-password">
          <p id="sb-err" style="color:var(--red);font-size:.82rem;margin:10px 0 0"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" id="sb-cancelar">Cancelar</button>
          <button type="button" class="btn-primary" id="sb-entrar">Entrar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const entrar = async () => {
      const btn = m.querySelector('#sb-entrar'), err = m.querySelector('#sb-err');
      btn.disabled = true; err.textContent = '';
      const { data, error } = await sbCliente().auth.signInWithPassword({
        email: m.querySelector('#sb-email').value.trim(), password: m.querySelector('#sb-pass').value
      });
      btn.disabled = false;
      if (error) { err.textContent = 'No se pudo entrar: revisá el email y la contraseña.'; return; }
      if (!_esAdmin(data.session)) { err.textContent = 'Este usuario no es administrador.'; await sbCliente().auth.signOut(); return; }
      m.remove(); _sbLoginPromesa = null; resolve(true);
    };
    m.querySelector('#sb-entrar').addEventListener('click', entrar);
    m.querySelector('#sb-pass').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
    m.querySelector('#sb-cancelar').addEventListener('click', () => { m.remove(); _sbLoginPromesa = null; reject(new Error('Ingreso cancelado')); });
    setTimeout(() => m.querySelector('#sb-email').focus(), 50);
  });
  return _sbLoginPromesa;
}

function _sbErr(error, que) {
  if (!error) return;
  const msg = /duplicate key|unique/i.test(error.message) ? 'Ya existe un producto con ese nombre en esa categoría'
            : /row-level security|permission/i.test(error.message) ? 'Sin permiso: volvé a entrar como administrador'
            : error.message;
  throw new Error((que ? que + ': ' : '') + msg);
}
// Formato argentino: "32.500" = 32500 · "1.234,50" = 1234.5 · "32500" / "32.5" tal cual
const _num = v => {
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s) || 0;
};
let _sbVar = {};   // id de variante → id de producto (del último listado)

// Filas con el mismo formato que usaba la planilla, para que la pantalla no cambie
async function sbListarProductos() {
  const { data, error } = await sbCliente().from('productos')
    .select('id,categoria,nombre,descripcion,subcategoria,destacado,imagenes,orden,variantes(id,color,talle,precio,precio_descuento,stock,sku_costo,imagen_url,orden)')
    .order('orden').range(0, 9999);
  _sbErr(error, 'Productos');
  _sbVar = {};
  const filas = [];
  data.forEach(p => (p.variantes || []).sort((a, b) => a.orden - b.orden).forEach(v => {
    _sbVar[v.id] = p.id;
    filas.push({
      _sheet: p.categoria, _row: v.id, _pid: p.id, _imagenes: p.imagenes || [],
      categoria: p.categoria, nombre: p.nombre, descripcion: p.descripcion || '', subcategoria: p.subcategoria || '',
      destacado: !!p.destacado, precio: Number(v.precio), descuento: v.precio_descuento === null ? '' : Number(v.precio_descuento),
      stock: !!v.stock, color: v.color || '', marca: '', talle: v.talle || '', sku: v.sku_costo || '',
      imagen: v.imagen_url || (p.imagenes || [])[0] || ''
    });
  }));
  return { ok: true, rows: filas };
}

async function _pidDe(vid) {
  if (_sbVar[vid]) return _sbVar[vid];
  const { data, error } = await sbCliente().from('variantes').select('producto_id').eq('id', vid).single();
  _sbErr(error, 'Variante'); return data.producto_id;
}

const _CAMPOS_VARIANTE = { precio: 'precio', descuento: 'precio_descuento', stock: 'stock', color: 'color', marca: 'color',
  'talle/medida': 'talle', talle: 'talle', sku_costo: 'sku_costo', sku: 'sku_costo', imagen_url: 'imagen_url' };
const _CAMPOS_PRODUCTO = { descripcion: 'descripcion', destacado: 'destacado', producto: 'nombre', nombre: 'nombre', subcategoria: 'subcategoria' };

const SB_ACCIONES = {
  ext_productos_list: sbListarProductos,

  async ext_producto_update(p) {
    const campo = String(p.campo || '').trim().toLowerCase(), vid = Number(p.row);
    let valor = p.valor;
    if (campo === 'stock' || campo === 'destacado') valor = String(valor) === 'true' || valor === true;
    else if (campo === 'precio') valor = _num(valor);
    else if (campo === 'descuento') valor = _num(valor) > 0 ? _num(valor) : null;
    else valor = String(valor ?? '').trim();
    if (_CAMPOS_VARIANTE[campo]) {
      const { error } = await sbCliente().from('variantes').update({ [_CAMPOS_VARIANTE[campo]]: valor === '' && campo === 'sku_costo' ? null : valor }).eq('id', vid);
      _sbErr(error, 'Guardar');
    } else if (_CAMPOS_PRODUCTO[campo]) {
      if (_CAMPOS_PRODUCTO[campo] === 'nombre' && !valor) throw new Error('El nombre no puede quedar vacío');
      const { error } = await sbCliente().from('productos').update({ [_CAMPOS_PRODUCTO[campo]]: valor }).eq('id', await _pidDe(vid));
      _sbErr(error, 'Guardar');
    } else {
      return { ok: false, error: 'Campo no encontrado: ' + campo };
    }
    return { ok: true };
  },

  async ext_producto_agregar(p) {
    const { data, error } = await sbCliente().from('productos')
      .insert({ categoria: p.sheet, nombre: String(p.nombre).trim(), orden: 999999 }).select('id').single();
    _sbErr(error, 'Agregar producto');
    const r = await sbCliente().from('variantes').insert({ producto_id: data.id, color: String(p.marca || '').trim(),
      precio: _num(p.precio), stock: _num(p.stock) > 0 });
    _sbErr(r.error, 'Agregar producto');
    return { ok: true, id: data.id };
  },

  async ext_variante_agregar(p) {
    const pid = await _pidDe(Number(p.row));
    let imagen = null;
    if (p.data) {   // la foto se sigue subiendo al repo de la tienda (GitHub)
      const f = await _crmEnviarOriginal({ action: 'producto_foto_subir', categoria: p.sheet, nombre: p.nombre, data: p.data });
      if (!f || f.ok === false) throw new Error((f && f.error) || 'No se pudo subir la foto');
      imagen = f.url;
    }
    const { data: hermanas } = await sbCliente().from('variantes').select('orden').eq('producto_id', pid);
    const orden = Math.max(-1, ...(hermanas || []).map(v => v.orden)) + 1;
    const { error } = await sbCliente().from('variantes').insert({ producto_id: pid, color: String(p.color || '').trim(),
      precio: _num(p.precio), stock: true, sku_costo: String(p.sku || '').trim() || null, imagen_url: imagen, orden });
    _sbErr(error, 'Agregar variante');
    return { ok: true };
  },

  async ext_producto_eliminar(p) {
    const vid = Number(p.row);
    const { data: v, error: e1 } = await sbCliente().from('variantes').select('producto_id, productos(nombre)').eq('id', vid).maybeSingle();
    _sbErr(e1, 'Eliminar');
    if (!v) return { ok: false, error: 'La lista cambió desde que la abriste. Tocá actualizar y volvé a intentar.' };
    if (p.nombre && v.productos && v.productos.nombre !== String(p.nombre).trim())
      return { ok: false, error: 'La lista cambió desde que la abriste. Tocá actualizar y volvé a intentar.' };
    const { error } = await sbCliente().from('variantes').delete().eq('id', vid);
    _sbErr(error, 'Eliminar');
    const { count } = await sbCliente().from('variantes').select('id', { count: 'exact', head: true }).eq('producto_id', v.producto_id);
    if (!count) await sbCliente().from('productos').delete().eq('id', v.producto_id);   // sin variantes: se va el producto
    return { ok: true };
  },

  async ext_categoria_agregar(p) {
    const { error } = await sbCliente().from('categorias').insert({ nombre: String(p.nombre).trim(), orden: 999 });
    _sbErr(error, 'Crear categoría');
    return { ok: true };
  },

  async ext_categoria_eliminar(p) {
    const e1 = (await sbCliente().from('productos').delete().eq('categoria', p.nombre)).error; _sbErr(e1, 'Eliminar categoría');
    const e2 = (await sbCliente().from('categorias').delete().eq('nombre', p.nombre)).error; _sbErr(e2, 'Eliminar categoría');
    return { ok: true };
  },

  async producto_fotos_set(p) {
    const urls = JSON.parse(p.urls || '[]');
    const { error } = await sbCliente().from('productos').update({ imagenes: urls }).eq('categoria', p.categoria).eq('nombre', p.nombre);
    _sbErr(error, 'Fotos');
    _productos.filter(x => x.categoria === p.categoria && x.nombre === p.nombre).forEach(x => { x._imagenes = urls; x.imagen = x.imagen || urls[0] || ''; });
    return { ok: true, fotos: urls };
  },

  async producto_foto_subir(p) {
    const r = await _crmEnviarOriginal(p);   // sube el archivo al repo de la tienda (GitHub)
    if (!r || r.ok === false) return r;
    const { data } = await sbCliente().from('productos').select('imagenes').eq('categoria', p.categoria).eq('nombre', p.nombre).single();
    const urls = [...new Set([...(data && data.imagenes || []), r.url])];
    await SB_ACCIONES.producto_fotos_set({ categoria: p.categoria, nombre: p.nombre, urls: JSON.stringify(urls) });
    return { ok: true, url: r.url, fotos: urls };
  },
};

let _crmOriginal = null, _crmEnviarOriginal = null;
if (CRM_PRODUCTOS_EN_SUPABASE && window.supabase) {
  // La lista guardada de la planilla usa números de fila, no ids de Supabase: se descarta una vez
  try {
    if (localStorage.getItem('vsb-crm-fuente') !== 'supabase') {
      ['vsbcrm_productos', 'vsbops_productos'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem('vsb-crm-fuente', 'supabase');
    }
  } catch (e) {}
  _crmOriginal = crm;
  _crmEnviarOriginal = crmEnviar;
  const desviar = async (params, original) => {
    const f = SB_ACCIONES[params.action];
    if (!f) return original(params);
    await sbAsegurarLogin();
    try { return await f(params); }
    catch (e) { return { ok: false, error: e.message }; }
  };
  crm = params => desviar(params, _crmOriginal);
  crmEnviar = params => desviar(params, _crmEnviarOriginal);
  // Las fotos de la ficha salen de Supabase (no del manifest)
  cargarFotos = async function(p) {
    _fotosProd = (p._imagenes || []).slice();
    if (_ghOk === null) { try { _ghOk = !!(await _crmEnviarOriginal({ action: 'gh_estado' })).gh; } catch (e) { _ghOk = false; } }
    renderFotos(p);
  };
}
