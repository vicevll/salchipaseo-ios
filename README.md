# SalchiPaseo iOS

Este proyecto es una app iOS (Capacitor) que abre la web de SalchiPaseo (https://vicevll.github.io/salchipaseo/). Le suma dos cosas que Safari no permite:

- **GPS en segundo plano**: la app sigue recibiendo ubicaciones con la pantalla bloqueada.
- **Avisos y alarmas**: son notificaciones locales que llegan aunque la app esté cerrada.

La app **carga tu web desde su URL**. Por eso, cuando cambias tu web, basta con publicarla como siempre: no hay que recompilar ni reinstalar nada.

```
capacitor.config.json        ← nombre, bundle ID y URL de tu web
scripts/preparar-ios.mjs     ← genera el proyecto de Xcode al compilar (permisos, textos)
para-tu-web/app-nativa.js    ← cópialo a tu web
www/error.html               ← pantalla que aparece si no hay internet
.github/workflows/           ← GitHub compila el .ipa en un Mac en la nube
icono.png (opcional)         ← tu ícono de 1024×1024
```

No hay carpeta `ios/` en el repo: se genera en cada compilación. Todo lo que necesitas cambiar lo puedes editar directamente en GitHub (ícono del lápiz → **Commit changes**) y la app se recompila sola.

---

## 1. Configuración

`capacitor.config.json`:

```json
{
  "appId": "cl.hazlacondatos.salchipaseo",
  "appName": "SalchiPaseo",
  "webDir": "www",
  "server": {
    "url": "https://vicevll.github.io/salchipaseo/",
    "errorPath": "error.html",
    "allowNavigation": ["vicevll.github.io"]
  }
}
```

- `appName`: el nombre que aparece bajo el ícono.
- `appId`: el identificador interno de la app. Después de instalarla no lo cambies, o perderás sus datos.
- `server.url`: la URL completa de tu web publicada, con `https://`.
- `server.allowNavigation`: dominios que se abren dentro de la app en vez de en Safari.

Los textos que iOS muestra al pedir permiso de ubicación están al inicio de `scripts/preparar-ios.mjs`.

**Ícono (opcional):** sube a la raíz del repo un archivo `icono.png` de 1024×1024, sin transparencia (**Add file → Upload files**).

## 2. Repositorio

https://github.com/vicevll/salchipaseo-ios

## 3. Compilar el .ipa

Cada vez que guardas un cambio en `main` (desde la web de GitHub o con git), GitHub compila solo. También puedes compilar a mano: pestaña **Actions** → **Compilar app iOS** → **Run workflow**.

La compilación tarda unos 5 a 10 minutos. Cuando termina, abre esa ejecución y descarga **SalchiPaseo-N.ipa** desde la sección **Artifacts**.

Cambiar solo el `README.md` o la carpeta `para-tu-web/` no dispara una compilación.

## 4. Instalar en el iPhone con Sideloadly (Windows)

**Preparación (una vez):**

1. Instala **iTunes** e **iCloud** descargados desde apple.com. Las versiones de la Microsoft Store no funcionan con Sideloadly.
2. Descarga **Sideloadly** desde sideloadly.io.
3. Conecta el iPhone por cable y acepta "Confiar en este computador".

**Instalar:**

1. Abre Sideloadly, arrastra el `.ipa` y escribe tu Apple ID.
2. Presiona **Start** e ingresa el código de verificación que te llega al iPhone.
3. En el iPhone, ve a **Ajustes → General → VPN y gestión de dispositivos**, toca tu Apple ID y luego **Confiar**.
4. Ve a **Ajustes → Privacidad y seguridad → Modo desarrollador**, actívalo y reinicia el iPhone. Esta opción aparece después de instalar la primera app.

> Sideloadly es una herramienta de terceros que usa tu Apple ID para firmar la app. Si prefieres no usar tu cuenta principal, crea un Apple ID secundario solo para esto.

## 5. Usarlo en tu web

Copia `para-tu-web/app-nativa.js` a tu web y cárgalo antes de tu código:

```html
<script src="app-nativa.js"></script>
<script src="tu-codigo.js"></script>
```

### GPS en segundo plano

```js
let detenerGPS;

async function empezarRecorrido() {
  detenerGPS = await AppNativa.seguirUbicacion(
    (ubi) => {
      console.log(ubi.latitude, ubi.longitude, ubi.accuracy);
      // Para guardar la ubicación aunque la pantalla esté bloqueada:
      AppNativa.enviar("https://tu-api.com/ubicaciones", ubi, { Authorization: "Bearer ..." });
    },
    (error) => {
      if (error.code === "NOT_AUTHORIZED") AppNativa.abrirAjustes();
    },
    { distanciaMinima: 20 } // metros
  );
}

function terminarRecorrido() {
  if (detenerGPS) detenerGPS();
}
```

- Empieza el seguimiento con la app abierta. Después puedes bloquear la pantalla, y verás un indicador azul arriba mientras se registra la ubicación.
- Usa `AppNativa.enviar` para mandar datos a tu servidor: en la app usa la conexión nativa de iOS, que funciona mejor en segundo plano que `fetch`.

### Avisos y alarmas

```js
await AppNativa.pedirPermisoAvisos();                  // una vez, idealmente al tocar un botón

const id = await AppNativa.programarAviso(
  "¡Tiempo!", "Terminó tu temporizador de 25 min", 25 * 60   // segundos desde ahora
);

await AppNativa.programarAviso("Reunión", "En 10 minutos", new Date("2026-12-01T09:50:00"));

await AppNativa.cancelarAviso(id);

AppNativa.alTocarAviso((aviso) => console.log("Tocó", aviso.id, aviso.extra));
```

No uses `setTimeout` para alarmas: deja de correr cuando la app pasa a segundo plano. Un aviso programado lo entrega iOS a la hora indicada, aunque la app esté cerrada.

Para usar un sonido propio, sube un archivo `.wav` o `.caf` (de 30 segundos como máximo) a la carpeta `www/` de este repo y pasa `{ sonido: "alarma.wav" }`.

`AppNativa.esApp` vale `true` dentro de la app y `false` en el navegador. Así puedes mostrar u ocultar funciones según dónde se abra tu web.

---

## Cómo actualizar

| Qué cambiaste | Qué hacer |
|---|---|
| Tu web (HTML, JS, CSS) | Publícala como siempre en GitHub Pages. En el iPhone, cierra la app deslizándola hacia arriba y ábrela de nuevo. GitHub Pages puede tardar hasta ~10 minutos en mostrar la versión nueva por su caché. |
| Algo nativo (permisos, nombre, ícono, sonidos) | Edita o sube el archivo en este repo desde GitHub. Cuando termine la compilación, descarga el nuevo `.ipa` e instálalo con Sideloadly encima del anterior. |
| Pasaron 7 días | Vuelve a instalar el mismo `.ipa` con Sideloadly, con el mismo Apple ID. **No borres la app** antes, así conservas sus datos. |

## Límites de la cuenta gratis

- La firma dura **7 días**. Después, la app no abre hasta que la vuelvas a instalar con Sideloadly.
- Puedes tener **3 apps** instaladas así al mismo tiempo, y registrar hasta 10 bundle IDs nuevos por semana.
- No hay notificaciones push enviadas desde un servidor. Los avisos locales de esta app sí funcionan.
- Los avisos respetan el modo silencio y los modos de concentración del iPhone.

## Problemas comunes

- **La app muestra "No se pudo cargar la app"**: no hay internet o la URL en `capacitor.config.json` está mal.
- **Un link abre Safari en vez de quedarse en la app**: la app solo navega dentro de tu dominio. Si necesitas otro dominio (por ejemplo, un login externo), agrégalo a la lista `server.allowNavigation` en `capacitor.config.json`.
- **La compilación falla**: abre la ejecución en la pestaña **Actions**, revisa el paso marcado en rojo y copia el error.
- **Sideloadly dice que tu Apple ID no puede crear más apps**: alcanzaste el límite semanal de bundle IDs. Espera unos días o borra apps de prueba.
