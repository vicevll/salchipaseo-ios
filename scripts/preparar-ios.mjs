// Genera y configura el proyecto iOS antes de compilar.
// Lo ejecuta GitHub Actions en un Mac; no necesitas correrlo en tu PC.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { prepararPlugin, agregarWidget } from "./actividad-en-vivo.mjs";

// Textos que iOS muestra al pedir permiso de ubicación (puedes cambiarlos)
const TEXTO_UBICACION_AL_USAR = "Guau Guau usa tu ubicación para registrar el recorrido del paseo.";
const TEXTO_UBICACION_SIEMPRE = "Guau Guau necesita tu ubicación también con la pantalla bloqueada para seguir registrando el paseo.";

const config = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const serverUrl = config.server?.url;
if (!serverUrl || serverUrl.includes("TU-WEB")) {
  console.error('ERROR: pon la URL de tu web en "server.url" dentro de capacitor.config.json');
  process.exit(1);
}

// 1) URL de tu web en la página de "sin conexión"
const errorPath = "www/error.html";
writeFileSync(errorPath, readFileSync(errorPath, "utf8").replaceAll("__SERVER_URL__", serverUrl));

// 1b) Plugin de la actividad en vivo (antes de crear el proyecto, para que Capacitor lo registre)
prepararPlugin();

// 2) Crear el proyecto de Xcode (o actualizarlo si ya existe)
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
if (!existsSync("ios")) run("npx cap add ios --packagemanager SPM");
else run("npx cap sync ios");

// 3) Info.plist: nombre, idioma, permisos y ubicación en segundo plano
const plistPath = "ios/App/App/Info.plist";
let plist = readFileSync(plistPath, "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const addBeforeEnd = (xml) => {
  plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, () => `${xml}\n</dict>\n</plist>\n`);
};
const setString = (key, value) => {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (re.test(plist)) plist = plist.replace(re, (_, a, b) => `${a}${esc(value)}${b}`);
  else addBeforeEnd(`\t<key>${key}</key>\n\t<string>${esc(value)}</string>`);
};
const setBool = (key, value) => {
  const re = new RegExp(`(<key>${key}</key>\\s*)<(?:true|false)\\s*/>`);
  const tag = value ? "<true/>" : "<false/>";
  if (re.test(plist)) plist = plist.replace(re, (_, a) => `${a}${tag}`);
  else addBeforeEnd(`\t<key>${key}</key>\n\t${tag}`);
};
setString("CFBundleDisplayName", config.appName);
setString("CFBundleDevelopmentRegion", "es");
setString("NSLocationWhenInUseUsageDescription", TEXTO_UBICACION_AL_USAR);
setString("NSLocationAlwaysAndWhenInUseUsageDescription", TEXTO_UBICACION_SIEMPRE);
// Actividad en vivo: el paseo en la pantalla bloqueada y en la isla dinámica
setBool("NSSupportsLiveActivities", true);
setBool("NSSupportsLiveActivitiesFrequentUpdates", true);
if (!plist.includes("<key>UIBackgroundModes</key>")) {
  addBeforeEnd("\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>");
} else if (!/<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*?<string>location<\/string>/.test(plist)) {
  plist = plist.replace(/(<key>UIBackgroundModes<\/key>\s*<array>)/, (m) => `${m}\n\t\t<string>location</string>`);
}
writeFileSync(plistPath, plist);

// 4) Bundle ID y número de build
const pbxPath = "ios/App/App.xcodeproj/project.pbxproj";
let pbx = readFileSync(pbxPath, "utf8");
pbx = pbx.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${config.appId};`);
if (process.env.GITHUB_RUN_NUMBER) {
  pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${process.env.GITHUB_RUN_NUMBER};`);
}
writeFileSync(pbxPath, pbx);

// 5) Esquema compartido "App" para que xcodebuild lo encuentre siempre
const schemeDir = "ios/App/App.xcodeproj/xcshareddata/xcschemes";
const target = pbx.match(/([0-9A-F]{24}) \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/);
if (target && !existsSync(`${schemeDir}/App.xcscheme`)) {
  const ref = `<BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "${target[1]}" BuildableName = "App.app" BlueprintName = "App" ReferencedContainer = "container:App.xcodeproj"></BuildableReference>`;
  mkdirSync(schemeDir, { recursive: true });
  writeFileSync(`${schemeDir}/App.xcscheme`, `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            ${ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <LaunchAction buildConfiguration = "Debug" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         ${ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES"></ArchiveAction>
</Scheme>
`);
}

// 6) Ícono propio (opcional): sube un icono.png de 1024x1024 a la raíz del repo
if (existsSync("icono.png")) {
  copyFileSync("icono.png", "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  console.log("Ícono: icono.png");
}

// 7) Actividad en vivo: extensión de widget con Goku caminando
await agregarWidget(config);

console.log(`App: ${config.appName} (${config.appId})`);
console.log(`Web: ${serverUrl}`);
