# Guau Guau · apps de iPhone y Android

Apps nativas (Capacitor) de Guau Guau. Cargan la web https://vicevll.github.io/salchipaseo/ y le suman:
GPS con la pantalla apagada, recordatorios, botón "volver" de Android y, en iPhone, el paseo en la pantalla bloqueada y la isla dinámica.

## Cómo se compila

Todo lo hace GitHub Actions (pestaña **Actions → Compilar apps → Run workflow**, o solo al subir cambios). En cada compilación aparecen:

| Archivo | Para qué |
|---|---|
| `GuauGuau-N.ipa` | Instalar en tu iPhone con Sideloadly |
| `GuauGuau-simulador-N.zip` | iPhone de prueba en el navegador (Appetize) |
| `GuauGuau-android-N.apk` | Android de prueba (Appetize o emulador de Android Studio) |
| `GuauGuau-N.aab` | El archivo que se sube a **Google Play** (aparece cuando están los secretos de la llave) |

## Secretos (Settings → Secrets and variables → Actions)

| Nombre | Para qué |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Llave de subida de Google Play (en base64) |
| `ANDROID_KEYSTORE_PASSWORD` | Clave de esa llave |
| `APPETIZE_TOKEN` | Opcional: sube solas las versiones de prueba a Appetize |

## Archivos

- `capacitor.config.json`: nombre, identificador y URL de la web.
- `icono.png`: ícono de 1024×1024 (iPhone y Android).
- `scripts/preparar-ios.mjs`, `scripts/actividad-en-vivo.mjs`: proyecto de Xcode, permisos e isla dinámica.
- `scripts/preparar-android.mjs`: proyecto Android, permisos, ícono, pantalla de carga y versión optimizada para Play.
- `scripts/subir-appetize.mjs`: envío opcional a Appetize.
- `www/`: página de respaldo cuando no hay conexión.
