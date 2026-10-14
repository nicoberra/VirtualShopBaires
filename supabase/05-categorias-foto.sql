-- Foto de cada categoría para el carrusel de la portada (se carga desde el CRM).
-- Vacía = la tienda usa la foto de siempre.
alter table public.categorias add column if not exists imagen_url text;
