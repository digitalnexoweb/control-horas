# Proyecto: Control de Horas

Aplicación web para registrar horas de trabajo, calcular ingresos y visualizar estadísticas.

El objetivo del proyecto es construir una app moderna que permita a un usuario registrar sus turnos de trabajo, ver cuánto dinero gana por mes y gestionar su información laboral.

---

# Arquitectura del proyecto

El proyecto está dividido en dos partes principales:

frontend/
backend/

---

# Frontend

Tecnologías:

- HTML
- CSS
- JavaScript (vanilla)
- Chart.js para gráficos
- Supabase Auth para autenticación

Archivos principales:

index.html  
style.css  
script.js  
auth.js  

Funciones principales del frontend:

- login y registro de usuario
- dashboard con dinero total y horas trabajadas
- gráfico mensual de ingresos
- calendario que marca días trabajados
- formulario para cargar horas
- tabla con detalle de horas cargadas
- borrar horas
- modo oscuro
- menú lateral
- perfil del usuario
- subida de recibos

El frontend consume la API del backend mediante fetch.

---

# Backend

Tecnologías:

- Node.js
- Express
- Supabase como base de datos

Deploy:

Render

Endpoints principales:

POST /add-hours  
DELETE /delete-hour/:id  
GET /resumen  
GET /hours-by-month  
GET /hours-by-calendar-month  

La tabla principal en Supabase es:

hours

Columnas principales:

id  
user_id  
date  
start_time  
end_time  
sector  
money  

El user_id corresponde al UUID generado por Supabase Auth.

---

# Funcionalidades actuales

- autenticación con Supabase
- registrar horas trabajadas
- cálculo automático de dinero ganado
- dashboard con métricas
- gráfico mensual de ingresos
- calendario con días trabajados
- borrar registros
- modo oscuro
- menú lateral responsive
- perfil del usuario (guardado en localStorage)
- subida de recibos (guardados en localStorage)

---

# Reglas de desarrollo

Cuando se hagan cambios en el proyecto:

- no romper funcionalidades existentes
- mantener compatibilidad mobile
- mantener JavaScript vanilla (no frameworks)
- mantener integración con Supabase Auth
- mantener estructura actual de API

Si se modifica HTML o CSS, verificar que script.js siga funcionando correctamente.

---

# Objetivo del proyecto

Convertir esta aplicación en una herramienta moderna para registrar horas laborales que pueda evolucionar a un producto más completo.

Futuras mejoras posibles:

- cargar horas desde el calendario
- estadísticas más avanzadas
- exportar datos a PDF
- mejor interfaz de usuario
- optimización mobile
- almacenamiento de perfil y recibos en base de datos

---

# Nota para el agente (Codex)

Antes de realizar cambios en el código:

1. Analizar la estructura del proyecto.
2. Revisar index.html, script.js y style.css.
3. Mantener compatibilidad con el backend existente.
4. Priorizar mejoras de interfaz y experiencia de usuario sin romper la lógica actual.

# Nota de continuidad

Última revisión real del proyecto:

- El frontend ya tiene `apiFetch()` centralizado en `frontend/script.js`.
- Ya están implementados estados de carga para:
  - guardar horas
  - guardar perfil
  - borrar horas
  - editar horas
  - cargar horas rápidas desde calendario
- Ya está implementada la edición de horas desde “Detalle de horas”.
- El backend ya expone `PUT /update-hour/:id`.
- `DELETE /delete-hour/:id` está alineado con el frontend y recibe `user_id` por body.
- El período del dashboard ya se muestra en formato amigable, por ejemplo `Febrero 2026`.
- El gráfico mensual ya usa labels amigables, por ejemplo `Feb 2026`.
- El perfil ya permite configurar `billing_cutoff_day` (día de cierre mensual) por usuario.
- El backend ya usa `billing_cutoff_day` en:
  - `GET /resumen`
  - `GET /hours-by-month`
- Si un usuario no tiene `billing_cutoff_day` configurado, se usa `20` por defecto para mantener compatibilidad.
- Los sectores ya no se crean automáticamente para usuarios nuevos.
- `Triage` y `Urgencia Domiciliaria` dejaron de sembrarse por defecto.
- Ahora cada usuario debe crear sus propios sectores desde Perfil antes de cargar horas si todavía no tiene ninguno.

Estado actual confirmado:

- Stack mantenido:
  - HTML
  - CSS
  - JavaScript vanilla
  - Supabase Auth
  - Backend Node + Express
  - Supabase
  - Render
- No se reescribió la app; las mejoras fueron sobre la base existente.
- La estructura principal actual sigue siendo:
  - `frontend/index.html`
  - `frontend/style.css`
  - `frontend/script.js`
  - `frontend/auth.js`
  - `backend/server.js`

Pendientes reales detectados en la última revisión:

1. Revisar experiencia inicial cuando el usuario no tiene sectores creados
- Hoy no se siembran sectores por defecto.
- Esto es lo esperado para cuentas nuevas.
- Verificar si conviene agregar:
  - texto de ayuda más visible
  - CTA para crear el primer sector
  - bloqueo visual más claro en formularios hasta que exista al menos un sector

2. Revisar navegación por año en el panel principal
- Los botones de meses del dashboard principal usan siempre el año actual.
- Eso impide navegar fácilmente a otros años desde esa vista.
- El calendario sí permite elegir mes y año.
- Evaluar si conviene agregar selector de año también al resumen principal.

3. Seguir profesionalizando el frontend sin romper lógica existente
- mantener compatibilidad mobile
- mantener JS vanilla
- no romper integración con Supabase Auth
- no romper endpoints actuales del backend

Si retomamos este proyecto más adelante, primero revisar:

1. `frontend/index.html`
2. `frontend/script.js`
3. `frontend/style.css`
4. `backend/server.js`

Siguiente paso sugerido al volver:

- Evaluar si hace falta mejorar el onboarding cuando no hay sectores creados todavía.
- Después evaluar mejora de navegación por año en la vista principal.

---

# Infraestructura actual

Estado de deploy confirmado en esta etapa:

- Repositorio Git actual:
  - `https://github.com/digitalnexoweb/control-horas`
- Frontend publicado en Netlify:
  - `https://controlhorasapp.netlify.app/`
- Backend publicado en Render:
  - `https://control-horas-waxk.onrender.com`

Configuración operativa elegida:

- Netlify publica solo `frontend/`.
- Render corre solo `backend/`.
- El frontend ya apunta al backend nuevo de Render.

Cambios realizados en esta etapa:

- Se migró el proyecto desde la cuenta Git anterior a la cuenta nueva `digitalnexoweb`.
- Se actualizó el remoto del repo local para usar el repositorio nuevo.
- Se conectó Netlify al repositorio nuevo y se configuró para publicar el frontend estático.
- Se creó/configuró un backend nuevo en Render apuntando al mismo repositorio.
- Se corrigió el frontend para que use `https://control-horas-waxk.onrender.com` como API remota.
- Se publicó una versión consistente del frontend para evitar mezcla de `index.html` viejo con `auth.js` nuevo.
- Se publicaron también los favicons y assets visuales actualizados.

Detalles importantes para no perder al retomar:

- Si en Netlify vuelve a aparecer un frontend viejo o mezclado, revisar primero que el último deploy haya tomado:
  - `frontend/index.html`
  - `frontend/auth.js`
  - `frontend/script.js`
  - favicons y `site.webmanifest`
- Si el login vuelve a fallar sin mensaje, sospechar desincronización entre `index.html` y `auth.js`.
- Si el backend parece responder pero faltan endpoints nuevos, revisar que Render esté desplegando desde:
  - `Root Directory: backend`
  - `Build Command: npm install`
  - `Start Command: npm start`

Variables importantes de producción en Render:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPROVAL_BASE_URL=https://control-horas-waxk.onrender.com`
- `CORS_ALLOWED_ORIGINS=https://controlhorasapp.netlify.app`

Nota breve sobre limpieza del repo:

- Ya quedaron versionados scripts locales de arranque y soporte:
  - `package.json`
  - `package-lock.json`
  - `start.sh`
  - `ecosystem.config.js`
- Feb 2026
- Mar 2026
o equivalente claro en español.

7. Mejorar experiencia al guardar horas
Actualmente al guardar se limpian todos los campos.
Quiero que:
- la fecha NO se limpie
- solo se limpien:
  - hora inicio
  - hora fin
  - sector

Esto es para que si cargo varios turnos del mismo día sea más rápido.

8. Claridad visual entre tarifas actuales y total del mes
Quiero que quede claro que:
- el total del dashboard depende de la lógica actual configurada
- las tarifas visibles son las actuales del perfil

No quiero que el usuario se confunda.
Si hace falta ajustar textos, subtítulos o labels para hacerlo más claro, hacelo.

--------------------------------
MEJORA IMPORTANTE: EDITAR HORAS DESDE DETALLE
--------------------------------

Quiero poder editar registros ya cargados desde la tabla o detalle de horas.

Necesito lo siguiente:

1. Agregar botón Editar en cada fila del detalle
Además del botón Eliminar, agregar un botón:
- Editar

2. Flujo de edición
Cuando el usuario toca Editar en un registro:
- abrir una interfaz para editar ese registro

Puede ser:
- un modal
o
- una card expandible
o
- un formulario inline debajo de la fila
o

--------------------------------
ACTUALIZACION DE CONTINUIDAD - MARZO 2026
--------------------------------

Trabajo reciente ya implementado:

- Se agregó un flujo base de aprobacion manual de usuarios para vender la app.
- El registro sigue haciéndose con `Supabase Auth` desde `frontend/auth.js`.
- Despues del `signUp`, el frontend llama al backend para registrar la solicitud de aprobacion.
- El backend:
  - marca al usuario como `pending`
  - genera un token unico
  - envia un mail de aprobacion al administrador
  - expone un link para aprobar al usuario
- Mientras el usuario no este aprobado, no puede usar la app.

Archivos modificados en esta etapa:

- `frontend/auth.js`
- `backend/server.js`
- `backend/package.json`
- `backend/.env.example`
- `backend/sql/004_add_user_approval_flow.sql`

Endpoints nuevos agregados en backend:

- `POST /auth/register-request`
- `GET /auth/approval-status`
- `GET /auth/approve-user?token=...`

Comportamiento actual del flujo de aprobacion:

1. El usuario crea cuenta en el frontend.
2. Supabase crea el usuario.
3. El frontend llama a `POST /auth/register-request`.
4. El backend guarda estado `pending` y manda mail al admin.
5. El admin recibe el mail en `digitalnexoweb@gmail.com`.
6. El admin aprueba entrando al link de `GET /auth/approve-user`.
7. El backend marca al usuario como `approved`.
8. Solo desde ese momento el usuario puede entrar y usar endpoints de horas.

Protecciones ya implementadas:

- `add-hours`, `resumen`, `hours-by-month`, `hours-by-calendar-month`, `delete-hour` y `update-hour`
  verifican si el usuario esta aprobado.
- Si el usuario esta `pending`, el backend responde `403`.
- El frontend tambien chequea el estado al iniciar sesion y al recuperar sesion.

Base de datos / SQL pendiente de aplicar:

- Ejecutar en Supabase el archivo:
  - `backend/sql/004_add_user_approval_flow.sql`

Variables de entorno nuevas requeridas en backend:

- `APPROVAL_BASE_URL`
- `ADMIN_APPROVAL_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`
- `MAIL_FROM`

Configuracion recomendada elegida:

- proveedor de mail recomendado: `Resend`
- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=465`
- `SMTP_USER=resend`
- `SMTP_SECURE=true`
- `ADMIN_APPROVAL_EMAIL=digitalnexoweb@gmail.com`

Importante sobre Resend:

- El usuario compartio una API key de Resend en el chat.
- Esa key debe considerarse comprometida.
- No reutilizar esa key.
- Revocarla en Resend y crear una nueva con permiso `sending_access`.

Pendiente manual real para la proxima vez:

1. Revocar la API key expuesta de Resend.
2. Crear una nueva API key para `control-horas-production`.
3. Confirmar cual es el dominio verificado en Resend.
4. Completar `MAIL_FROM` con ese dominio verificado.
5. Cargar variables nuevas en Render.
6. Ejecutar el SQL `004_add_user_approval_flow.sql` en Supabase.
7. Probar flujo completo:
   - registro
   - mail recibido por admin
   - aprobacion desde link
   - login permitido luego de aprobar

Notas tecnicas para retomar:

- `backend/.env.example` ya fue actualizado con las variables nuevas.
- `backend/.env` local ya tiene placeholders agregados para aprobacion y SMTP.
- No se completaron `SMTP_PASS` ni `MAIL_FROM` por seguridad.
- `node --check` paso correctamente en:
  - `backend/server.js`
  - `frontend/auth.js`

Riesgo / detalle a revisar al volver:

- En la instalacion local aparecieron warnings de engine porque `@supabase/supabase-js` actual pide `Node >= 20`.
- Revisar version de Node en Render y, si hace falta, mover deploy a Node 20.

Siguiente paso sugerido al volver:

- Terminar configuracion real de Resend + Render + Supabase.
- Probar el flujo de aprobacion de punta a punta.
- Recién despues seguir con mejoras de UI o dashboard.
- reutilizar el formulario principal cargando los datos

Elegí la solución más limpia y usable.

3. Datos editables
Quiero poder editar:
- fecha
- hora inicio
- hora fin
- sector

4. Guardado de edición
Al guardar cambios:
- llamar al backend para actualizar el registro
- recalcular correctamente:
  - horas normales
  - horas nocturnas
  - total money
según la lógica actual del backend

5. Después de editar
Actualizar automáticamente:
- detalle del mes
- dashboard
- calendario si corresponde
- gráfico si corresponde

6. Feedback visual
Mostrar toast de éxito al editar:
- “Hora actualizada correctamente”

Y si falla:
- toast de error claro

7. Requisito backend/frontend
Si el backend todavía no tiene endpoint de edición, agregalo o dejá preparado lo necesario.

Ejemplo posible:
PUT /update-hour/:id

Debe recibir:
- user_id
- date
- start_time
- end_time
- sector

Y recalcular todo correctamente en backend.

--------------------------------
MEJORA DEL DETALLE DE HORAS
--------------------------------

1. Hacer más claro el detalle
Quiero que el detalle de horas sea más útil y profesional.

Si es posible, en cada fila mostrar mejor:
- fecha
- horario
- sector
- monto
- acciones

2. Si backend ya devuelve esto, también mostrar:
- horas normales
- horas nocturnas

No tiene que quedar recargado, pero sí más claro.

3. En mobile
La vista mobile del detalle debe seguir funcionando bien.
No romper la tabla responsive actual.

--------------------------------
PERFIL
--------------------------------

1. Mantener bien funcionales:
- valor por hora normal
- valor por hora nocturna

2. Cuando el usuario guarda perfil:
- refrescar dashboard automáticamente

--------------------------------
ACTUALIZACION DE CONTINUIDAD - 30 MAR 2026
--------------------------------

Migracion de infraestructura realizada hoy:

- Se elimino la dependencia operativa del servidor Ubuntu para produccion.
- La app ya no depende de Render para el backend.
- El proyecto ahora queda preparado para funcionar con:
  - GitHub
  - Netlify
  - Supabase

Estado operativo confirmado:

- Repositorio Git actual:
  - `https://github.com/digitalnexoweb/control-horas`
- Sitio Netlify operativo actual:
  - `https://appcontrolhoras.netlify.app/`
- Produccion actual:
  - frontend en Netlify
  - backend en Netlify Functions
  - auth y base de datos en Supabase

Cambio tecnico principal de esta etapa:

- El backend Express fue adaptado para ejecutarse tambien como Netlify Function.
- Se creo:
  - `netlify/functions/api.js`
- Se agrego configuracion de Netlify en:
  - `netlify.toml`
- El frontend ya no apunta a Render ni a IPs locales.
- `frontend/script.js` y `frontend/auth.js` ahora consumen la API desde:
  - `/api`

Archivos tocados en esta migracion:

- `backend/server.js`
- `backend/package.json`
- `frontend/script.js`
- `frontend/auth.js`
- `package.json`
- `package-lock.json`
- `.nvmrc`
- `netlify.toml`
- `netlify/functions/api.js`

Detalles importantes implementados:

- Se fijo Node `20` para deploy.
- La function responde correctamente en:
  - `/.netlify/functions/api/health`
- La ruta publica esperada queda en:
  - `/api/...`
- Se corrigio el `basePath` de la function para que `/api/*` funcione bien en Netlify.

Nota importante sobre Netlify:

- El sitio viejo `controlhorasapp` quedo descartado por bloqueos del plan con contributors en repo privado.
- Se creo un sitio nuevo en Netlify para destrabar deploy:
  - `appcontrolhoras`
- Ese sitio nuevo fue el que termino publicando correctamente el commit actualizado.
- Si mas adelante se quiere recuperar el nombre anterior, revisar `Domain management` del sitio nuevo.

Variables de entorno que deben existir en el proyecto Netlify activo:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPROVAL_BASE_URL`
- `ADMIN_APPROVAL_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`
- `MAIL_FROM`

Validaciones reales hechas al finalizar:

- el deploy nuevo en Netlify publico correctamente
- desaparecio el error de `unrecognized Git contributor`
- la API dejo de responder `404` en `/api/...`
- el usuario confirmo que la app funciona correctamente en produccion

Flujo de trabajo recomendado desde ahora:

1. Abrir el proyecto local en:
   - `/home/agus/control-horas`
2. Editar archivos en local
3. Hacer:
   - `git add .`
   - `git commit -m "mensaje"`
   - `git push origin main`
4. Netlify redeploya desde GitHub

Importante para retomar despues:

- La app ya no necesita Ubuntu para funcionar online.
- Ubuntu/WSL solo queda como entorno local de desarrollo.
- Los cambios quedan guardados:
  - localmente en `/home/agus/control-horas`
  - en GitHub luego de `git push`
- Si se prueba desde Windows y no se encuentra la carpeta, recordar que el proyecto esta dentro de WSL.
- refrescar visualmente los valores mostrados en cards

3. Mantener compatibilidad con Supabase
No romper loadProfile() ni saveProfile().

--------------------------------
CALENDARIO
--------------------------------

1. Mantener la carga rápida desde calendario.
2. Que siga funcionando después de cualquier mejora.
3. Si se edita o elimina un registro y eso afecta un día, actualizar el calendario correctamente.

--------------------------------
RECIBOS
--------------------------------

No quiero rehacer recibos ahora, pero sí dejar el código más preparado para una migración futura a storage real.
Si hace falta ordenar o mejorar naming, hacelo sin romper lo que hoy funciona.

--------------------------------
IMPORTANTE
--------------------------------

No romper:
- login
- register
- logout
- dark mode
- guardar horas
- borrar horas
- dashboard
- gráfico mensual
- calendario
- perfil
- recibos
- carga rápida desde calendario

--------------------------------
ESTILO DE IMPLEMENTACIÓN
--------------------------------

Quiero cambios concretos sobre mis archivos actuales.
No quiero teoría solamente.

Quiero que:
- modifiques HTML, CSS y JS si hace falta
- si hace falta tocar backend para editar horas, hacelo
- mantengas JavaScript vanilla
- mantengas compatibilidad mobile
- mejores UX y claridad general

--------------------------------
RESULTADO ESPERADO
--------------------------------

Quiero que me devuelvas:
- archivos corregidos
- frontend más claro y sólido
- labels más amigables
- mejor experiencia de uso
- detalle con edición de horas
- mejor consistencia entre frontend y backend
