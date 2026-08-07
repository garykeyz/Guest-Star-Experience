# Búsqueda consciente del idioma

El huésped debe elegir el idioma para cada canción. **Submit another song**
borra la selección anterior y vuelve siempre a preguntar el idioma.

Idiomas admitidos: español, inglés, francés, italiano, alemán, ruso y portugués.
La etiqueta inicial se muestra en inglés como idioma universal, pero se guarda
el valor interno compatible con Sheets y la búsqueda.

## Prioridad

- Se construyen términos regionales propios para cada idioma.
- Se descartan resultados con evidencia explícita de otro idioma.
- Se priorizan canales configurados para el idioma seleccionado.
- Primero se aceptan versiones karaoke con letra visible.
- Como respaldo se aceptan versiones lyrics con voces y texto visible.
- No existe caída silenciosa a inglés.

Sheets guarda un solo mejor enlace. Bridge conserva hasta seis candidatos para
que el Host elija y reemplaza la misma fuente cuando copia otra opción.
