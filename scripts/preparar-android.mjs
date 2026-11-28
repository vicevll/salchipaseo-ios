// Genera y configura el proyecto Android: APK de prueba y, si hay llave, el .aab para Google Play.
// Lo ejecuta GitHub Actions en Linux; no necesitas correrlo en tu PC.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const config = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const serverUrl = config.server?.url;
if (!serverUrl) { console.error('ERROR: falta "server.url" en capacitor.config.json'); process.exit(1); }

// 1) URL de la web en la página de "sin conexión"
const errorPath = "www/error.html";
writeFileSync(errorPath, readFileSync(errorPath, "utf8").replaceAll("__SERVER_URL__", serverUrl));

// 2) Crear el proyecto Android (o actualizarlo si ya existe)
if (!existsSync("android")) run("npx cap add android");
else run("npx cap sync android");

// 3) AndroidManifest: sin respaldo automático, sin alarmas exactas y el servicio de GPS cerrado a otras apps
const manPath = "android/app/src/main/AndroidManifest.xml";
let man = readFileSync(manPath, "utf8");
if (!man.includes("xmlns:tools")) {
  man = man.replace("<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"",
    "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"\n    xmlns:tools=\"http://schemas.android.com/tools\"");
}
man = man.replace('android:allowBackup="true"', 'android:allowBackup="false"');
// Solo vertical: la app no se gira
if (!man.includes("android:screenOrientation")) {
  man = man.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"');
}
if (!man.includes("BackgroundGeolocationService")) {
  man = man.replace("</application>",
    "    <service android:name=\"com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService\"\n" +
    "            android:exported=\"false\" tools:replace=\"android:exported\" />\n    </application>");
}
if (!man.includes("SCHEDULE_EXACT_ALARM")) {
  man = man.replace("</manifest>",
    "    <!-- Los recordatorios no necesitan precisión al segundo: sin permiso de alarmas exactas -->\n" +
    "    <uses-permission android:name=\"android.permission.SCHEDULE_EXACT_ALARM\" tools:node=\"remove\" />\n</manifest>");
}
writeFileSync(manPath, man);

// 4) Ícono y pantalla de carga con el logo (icono.png de 1024x1024 en la raíz del repo)
const ROJO = { r: 221, g: 77, b: 69, alpha: 1 };
const res = "android/app/src/main/res";
writeFileSync(join(res, "values/ic_launcher_background.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#DD4D45</color>\n</resources>\n');
if (existsSync("icono.png")) {
  try { await import("sharp"); } catch { run("npm install --no-save --no-audit --no-fund sharp@0.35"); }
  const { default: sharp } = await import("sharp");
  const logo = readFileSync("icono.png");
  const tam = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, px] of Object.entries(tam)) {
    const dir = join(res, `mipmap-${d}`);
    await sharp(logo).resize(px, px).png().toFile(join(dir, "ic_launcher.png"));
    const circulo = Buffer.from(`<svg width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}"/></svg>`);
    await sharp(logo).resize(px, px).composite([{ input: circulo, blend: "dest-in" }]).png().toFile(join(dir, "ic_launcher_round.png"));
    // Ícono adaptable: 108dp con la huella dentro de la zona segura
    const fg = Math.round(px * 108 / 48);
    await sharp(logo).resize(fg, fg).png().toFile(join(dir, "ic_launcher_foreground.png"));
  }
  // Pantallas de carga: fondo rojo del logo con el logo al centro
  const splashes = [];
  const buscar = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) buscar(p); else if (n === "splash.png") splashes.push(p); } };
  buscar(res);
  for (const p of splashes) {
    const { width, height } = await sharp(p).metadata();
    const lado = Math.round(Math.min(width, height) * 0.32);
    const centro = await sharp(logo).resize(lado, lado).png().toBuffer();
    await sharp({ create: { width, height, channels: 4, background: ROJO } })
      .composite([{ input: centro, gravity: "center" }]).png().toFile(p + ".tmp");
    writeFileSync(p, readFileSync(p + ".tmp")); execSync(`rm -f "${p}.tmp"`);
  }
  console.log(`Ícono y ${splashes.length} pantallas de carga: listos`);
}

// 5) GPS sin cortes con el ahorro de batería: plugin propio "Energia" (estado y permiso para funcionar sin restricciones)
const paquete = config.appId;
const carpetaJava = join("android/app/src/main/java", ...paquete.split("."));
writeFileSync(join(carpetaJava, "EnergiaPlugin.java"), `package ${paquete};

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Para que el GPS del paseo no se corte con el ahorro de batería de Android ni de cada marca.
@CapacitorPlugin(name = "Energia")
public class EnergiaPlugin extends Plugin {
    private PowerManager pm() { return (PowerManager) getContext().getSystemService(Context.POWER_SERVICE); }

    @PluginMethod
    public void estado(PluginCall call) {
        PowerManager pm = pm();
        String pkg = getContext().getPackageName();
        boolean ahorro = pm != null && pm.isPowerSaveMode();
        int modoGps = (pm != null && Build.VERSION.SDK_INT >= 28) ? pm.getLocationPowerSaveMode() : 0;
        JSObject r = new JSObject();
        r.put("sinRestricciones", pm == null || Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(pkg));
        r.put("ahorroActivo", ahorro);
        r.put("gpsLimitado", ahorro && modoGps != 0);
        r.put("fabricante", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        call.resolve(r);
    }

    // Muestra el aviso de Android "¿Permitir que la app se ejecute siempre en segundo plano?"
    @PluginMethod
    public void pedirSinRestricciones(PluginCall call) {
        String pkg = getContext().getPackageName();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            abrir(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
        call.resolve();
    }

    // Ajustes de la app (ahí cada marca pone su "batería", "inicio automático", etc.)
    @PluginMethod
    public void abrirAjustesApp(PluginCall call) {
        abrir(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    private void abrir(Intent i) {
        try { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(i); } catch (Exception ignored) {}
    }
}
`);
const mainPath = join(carpetaJava, "MainActivity.java");
let main = readFileSync(mainPath, "utf8");
if (!main.includes("EnergiaPlugin")) {
  main = main.replace("import com.getcapacitor.BridgeActivity;", "import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;")
    .replace(/public class MainActivity extends BridgeActivity \{\s*\}/, `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EnergiaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}`);
  writeFileSync(mainPath, main);
}
if (!readFileSync(mainPath, "utf8").includes("registerPlugin(EnergiaPlugin.class)")) {
  console.warn("AVISO: no pude registrar el plugin Energia en MainActivity: la app funciona igual, pero sin el aviso de batería.");
}
// Que R8 (la versión optimizada) no borre ni renombre el plugin
const proguardPath = "android/app/proguard-rules.pro";
const reglas = existsSync(proguardPath) ? readFileSync(proguardPath, "utf8") : "";
if (!reglas.includes("EnergiaPlugin")) {
  writeFileSync(proguardPath, reglas + `\n# Plugin propio de batería (Guau Guau)\n-keep class ${paquete}.EnergiaPlugin { *; }\n`);
}
man = readFileSync(manPath, "utf8");
if (!man.includes("REQUEST_IGNORE_BATTERY_OPTIMIZATIONS")) {
  man = man.replace("</manifest>",
    "    <!-- App de seguimiento de actividad: pide funcionar sin restricciones de batería para no cortar el GPS del paseo -->\n" +
    "    <uses-permission android:name=\"android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS\" />\n</manifest>");
  writeFileSync(manPath, man);
}

// 6) Versión con el número de compilación y la de producción optimizada (R8), como pide Google Play
const gradlePath = "android/app/build.gradle";
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/minifyEnabled false/, "minifyEnabled true\n            shrinkResources true")
  .replace("getDefaultProguardFile('proguard-android.txt')", "getDefaultProguardFile('proguard-android-optimize.txt')");
const n = process.env.GITHUB_RUN_NUMBER || "1";
gradle = gradle.replace(/versionCode \d+/, `versionCode ${n}`).replace(/versionName "[^"]*"/, `versionName "1.0.${n}"`);
writeFileSync(gradlePath, gradle);

console.log(`Android listo: ${config.appName} (${config.appId})`);
