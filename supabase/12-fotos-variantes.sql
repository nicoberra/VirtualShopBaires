-- Varias fotos por variante. imagen_url sigue siendo la principal (la primera de la lista),
-- así lo que ya leía imagen_url sigue andando igual.
alter table public.variantes add column if not exists imagenes text[] not null default '{}';

-- La foto que ya tenía cada variante pasa a ser la primera de su lista
update public.variantes
   set imagenes = array[imagen_url]
 where imagen_url is not null and imagen_url <> '' and cardinality(imagenes) = 0;

-- La tienda (clave pública) puede leer la nueva columna, igual que imagen_url
grant select (imagenes) on public.variantes to anon;

-- Comprobación
select count(*) filter (where cardinality(imagenes) > 0) as variantes_con_fotos,
       count(*) filter (where imagen_url is not null and imagen_url <> '') as con_imagen_url
  from public.variantes;
