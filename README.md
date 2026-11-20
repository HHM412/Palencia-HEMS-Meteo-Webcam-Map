# Mapa de Webcams de España

Aplicación web con mapa público de webcams y panel privado para administrarlas. Preparada para Render + PostgreSQL.

## Funcionalidades

- Mapa público Leaflet + OpenStreetMap.
- Marcadores geográficos y ventana emergente con iframe.
- Buscador por nombre/provincia y filtros por categoría.
- Panel `/admin` con autenticación.
- Alta, edición, activación/desactivación y borrado de webcams.
- Selección de coordenadas haciendo clic en el mapa del panel.
- PostgreSQL para cámaras, administradores y sesiones.
- Contraseñas con hash bcrypt, sesiones almacenadas en PostgreSQL, protección CSRF en operaciones de escritura y limitación de intentos de login.

## Requisitos

- Node.js 20 o superior
- PostgreSQL
- npm

## Desarrollo local

1. Crea una base de datos PostgreSQL llamada `webcams`.
2. Copia `.env.example` a `.env`.
3. Ajusta `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` y `SESSION_SECRET`.
4. Instala dependencias e inicia:

```bash
npm install
npm start
```

Abre `http://localhost:3000`. El panel está en `http://localhost:3000/admin`.

Genera un secreto de sesión aleatorio, por ejemplo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

El administrador inicial se crea al arrancar si `ADMIN_USERNAME` y `ADMIN_PASSWORD` están configurados. Si ya existe ese nombre de usuario, el arranque no cambia su contraseña. Para cambiar credenciales, actualiza el usuario desde la base de datos o crea un mecanismo de cambio de contraseña antes de abrir el servicio al público.

## Despliegue en Render

### Opción A: configuración manual

1. Sube el contenido de este proyecto a un repositorio privado o público de GitHub.
2. En Render crea una base de datos PostgreSQL.
3. En Render crea un **Web Service** y conecta el repositorio.
4. Configura:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Añade variables de entorno al Web Service:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = Internal Database URL de tu PostgreSQL de Render
   - `ADMIN_USERNAME` = nombre de administrador deseado
   - `ADMIN_PASSWORD` = contraseña larga, única y segura
   - `SESSION_SECRET` = secreto aleatorio de al menos 32 caracteres
   - `PGSSL` = `false` para la URL interna de Render. Si utilizas un proveedor PostgreSQL externo que exige SSL, usa `true`.
   - `APP_ORIGIN` = URL pública exacta, por ejemplo `https://tu-app.onrender.com` (sin barra final)
6. Despliega. El servidor crea las tablas automáticamente al iniciar.

**Importante:** utiliza la URL interna de PostgreSQL cuando la base de datos y el servicio web estén en Render y en la misma región. No publiques los valores secretos en GitHub.

### Opción B: Blueprint

El archivo `render.yaml` de este repositorio declara el Web Service y una base PostgreSQL. Revisa el plan y la región que Render muestre antes de confirmar; la base de datos puede generar costes.

## Añadir una webcam

1. Abre `https://tu-app.onrender.com/admin`.
2. Inicia sesión con las credenciales configuradas.
3. Completa nombre, provincia, categoría y URL.
4. Haz clic en el mapa para rellenar latitud y longitud, o escríbelas.
5. Marca «Publicar en el mapa» y guarda.

Las cámaras desactivadas solo aparecen en administración. Las cámaras activas aparecen en el mapa público.

## Importante sobre los iframes

La aplicación intenta mostrar la URL de cada webcam dentro de un iframe. El propietario de la web de la cámara puede impedir la inserción mediante las cabeceras `X-Frame-Options` o `Content-Security-Policy`. Si ocurre, el navegador bloqueará el iframe aunque la URL sea correcta. En ese caso, utiliza una URL oficial de inserción/embed o deja disponible el enlace «Abrir webcam en otra pestaña».

Antes de publicar una cámara, comprueba que tienes permiso para enlazarla o embeberla y que la fuente ofrece una URL compatible. No todas las páginas de webcams permiten ser embebidas.

## Cartografía y atribución

El mapa utiliza los tiles estándar de OpenStreetMap. Respeta la política de uso de los servidores de tiles y muestra siempre la atribución. Para tráfico elevado o uso comercial, contrata un proveedor de tiles o aloja tu propia infraestructura cartográfica: https://operations.osmfoundation.org/policies/tiles/

## Endpoints principales

- `GET /api/health` — estado del servidor y base de datos
- `GET /api/webcams` — webcams públicas activas
- `POST /api/login` — inicio de sesión
- `GET /api/session` — sesión actual
- `POST /api/logout` — cierre de sesión
- `GET /api/admin/webcams` — listado completo (autenticado)
- `POST /api/admin/webcams` — alta (autenticado + CSRF)
- `PUT /api/admin/webcams/:id` — edición (autenticado + CSRF)
- `DELETE /api/admin/webcams/:id` — borrado (autenticado + CSRF)

## Notas de seguridad y producción

- No existe registro público de administradores.
- La contraseña se guarda con bcrypt, nunca en texto plano.
- La cookie de sesión es `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Las sesiones se guardan en PostgreSQL.
- Protege el acceso al panel y limita los intentos de login.
- Usa secretos fuertes y no compartas el acceso de administrador.
- Añade copias de seguridad de PostgreSQL y monitorización antes de un uso público importante.
- La CSP permite iframes HTTP/HTTPS porque las cámaras son de terceros. Para un proyecto con lista cerrada de proveedores, restringe `frame-src` a esos dominios concretos.
- Este proyecto es una base funcional inicial; antes de un lanzamiento con tráfico importante conviene realizar pruebas de seguridad, accesibilidad y carga.
