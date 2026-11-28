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

// 5) Versión con el número de compilación y la de producción optimizada (R8), como pide Google Play
const gradlePath = "android/app/build.gradle";
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/minifyEnabled false/, "minifyEnabled true\n            shrinkResources true")
  .replace("getDefaultProguardFile('proguard-android.txt')", "getDefaultProguardFile('proguard-android-optimize.txt')");
const n = process.env.GITHUB_RUN_NUMBER || "1";
gradle = gradle.replace(/versionCode \d+/, `versionCode ${n}`).replace(/versionName "[^"]*"/, `versionName "1.0.${n}"`);
writeFileSync(gradlePath, gradle);

console.log(`Android listo: ${config.appName} (${config.appId})`);
