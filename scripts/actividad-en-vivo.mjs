// Actividad en vivo de Guau Guau (antes SalchiPaseo): el paseo en la pantalla bloqueada y en la isla dinámica.
// La usa scripts/preparar-ios.mjs al compilar en GitHub Actions; no necesitas correrla en tu PC.
//
//  1) prepararPlugin(): crea el plugin de Capacitor "salchi-live" (Swift + ActivityKit) y lo instala,
//     antes de generar el proyecto de Xcode, para que Capacitor lo registre solo.
//  2) agregarWidget(config): crea la extensión de widget "SalchiLive" (SwiftUI) con las imágenes de
//     Goku caminando y la agrega al proyecto de Xcode.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const escribir = (ruta, texto) => {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
};

/* ------------------------------------------------------------------------------------------ */
/* Datos compartidos entre el plugin (la app) y la extensión (el widget)                       */
/* ------------------------------------------------------------------------------------------ */
const ATRIBUTOS_SWIFT = String.raw`#if canImport(ActivityKit)
import ActivityKit
import Foundation

// Debe llamarse igual y tener los mismos campos en la app y en la extensión.
@available(iOS 16.1, *)
public struct SalchiLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var inicio: Date      // inicio del paseo, corrido por el tiempo en pausa
        public var pausa: Date?      // desde cuándo está en pausa (nil si avanza)
        public var metros: Double
        public var metaMin: Int      // mínimo del paseo, en minutos
        public var cuadro: Int       // pose del perro (cambia en cada actualización)
        public var segundos: Int     // duración final (al terminar)
        public var terminado: Bool
        public var raza: String      // salchicha, pug o golden: cambia el perro que camina

        public init(inicio: Date, pausa: Date?, metros: Double, metaMin: Int, cuadro: Int, segundos: Int, terminado: Bool, raza: String) {
            self.inicio = inicio
            self.pausa = pausa
            self.metros = metros
            self.metaMin = metaMin
            self.cuadro = cuadro
            self.segundos = segundos
            self.terminado = terminado
            self.raza = raza
        }
    }

    public var perro: String

    public init(perro: String) {
        self.perro = perro
    }
}
#endif
`;

/* ------------------------------------------------------------------------------------------ */
/* Plugin de Capacitor (lo llama app-nativa.js → AppNativa.actividad)                           */
/* ------------------------------------------------------------------------------------------ */
const PLUGIN_SWIFT = String.raw`import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(SalchiLivePlugin)
public class SalchiLivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SalchiLivePlugin"
    public let jsName = "SalchiLive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "actualizar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "terminar", returnType: CAPPluginReturnPromise)
    ]

    @objc func disponible(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            call.resolve([
                "disponible": ActivityAuthorizationInfo().areActivitiesEnabled,
                "activa": !Activity<SalchiLiveAttributes>.activities.isEmpty
            ])
            return
        }
        #endif
        call.resolve(["disponible": false, "activa": false])
    }

    @objc func iniciar(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let perro = call.getString("perro") ?? "tu perro"
            let estado = SalchiLivePlugin.estado(call, terminado: false)
            Task {
                var reutilizada = false
                for actividad in Activity<SalchiLiveAttributes>.activities {
                    if !reutilizada && actividad.activityState == .active && actividad.attributes.perro == perro {
                        await actividad.update(ActivityContent(state: estado, staleDate: nil))
                        reutilizada = true
                    } else {
                        await actividad.end(nil, dismissalPolicy: .immediate)
                    }
                }
                if reutilizada {
                    call.resolve(["ok": true, "reutilizada": true])
                    return
                }
                guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                    call.reject("Las actividades en vivo están desactivadas para Guau Guau en Ajustes", "DESACTIVADAS")
                    return
                }
                do {
                    _ = try Activity<SalchiLiveAttributes>.request(
                        attributes: SalchiLiveAttributes(perro: perro),
                        content: ActivityContent(state: estado, staleDate: nil),
                        pushType: nil)
                    call.resolve(["ok": true, "reutilizada": false])
                } catch {
                    call.reject("No se pudo iniciar la actividad en vivo: \(error.localizedDescription)", "ERROR")
                }
            }
            return
        }
        #endif
        call.unavailable("Las actividades en vivo requieren iOS 16.2 o superior")
    }

    @objc func actualizar(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let estado = SalchiLivePlugin.estado(call, terminado: false)
            Task {
                for actividad in Activity<SalchiLiveAttributes>.activities where actividad.activityState == .active {
                    await actividad.update(ActivityContent(state: estado, staleDate: nil))
                }
                call.resolve(["ok": true])
            }
            return
        }
        #endif
        call.unavailable("Las actividades en vivo requieren iOS 16.2 o superior")
    }

    @objc func terminar(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let inmediato = call.getBool("inmediato") ?? false
            let estado = SalchiLivePlugin.estado(call, terminado: true)
            Task {
                for actividad in Activity<SalchiLiveAttributes>.activities {
                    if inmediato {
                        await actividad.end(nil, dismissalPolicy: .immediate)
                    } else {
                        await actividad.end(ActivityContent(state: estado, staleDate: nil),
                                            dismissalPolicy: .after(Date().addingTimeInterval(120)))
                    }
                }
                call.resolve(["ok": true])
            }
            return
        }
        #endif
        call.resolve(["ok": false])
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private static func estado(_ call: CAPPluginCall, terminado: Bool) -> SalchiLiveAttributes.ContentState {
        func fecha(_ clave: String) -> Date? {
            guard let ms = call.getDouble(clave) else { return nil }
            return Date(timeIntervalSince1970: ms / 1000)
        }
        return SalchiLiveAttributes.ContentState(
            inicio: fecha("inicio") ?? Date(),
            pausa: fecha("pausa"),
            metros: call.getDouble("metros") ?? 0,
            metaMin: call.getInt("metaMin") ?? 30,
            cuadro: call.getInt("cuadro") ?? 0,
            segundos: call.getInt("segundos") ?? 0,
            terminado: terminado,
            raza: ["salchicha", "pug", "golden"].contains(call.getString("raza") ?? "") ? call.getString("raza")! : "salchicha")
    }
    #endif
}
`;

const PACKAGE_SWIFT = String.raw`// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SalchiLive",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "SalchiLive", targets: ["SalchiLivePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SalchiLivePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/SalchiLivePlugin")
    ]
)
`;

/* ------------------------------------------------------------------------------------------ */
/* Extensión de widget: cómo se ve en la pantalla bloqueada y en la isla dinámica               */
/* ------------------------------------------------------------------------------------------ */
const WIDGET_SWIFT = String.raw`import ActivityKit
import SwiftUI
import WidgetKit

// Colores de Guau Guau
enum Paleta {
    static let naranja = Color(red: 1.0, green: 0.42, blue: 0.102)       // #FF6B1A
    static let amarillo = Color(red: 1.0, green: 0.776, blue: 0.161)     // #FFC629
    static let cieloArriba = Color(red: 0.082, green: 0.267, blue: 0.761) // #1544C2
    static let cieloAbajo = Color(red: 0.357, green: 0.549, blue: 1.0)    // #5B8CFF
}

func redondeada(_ tamano: CGFloat, _ peso: Font.Weight = .bold) -> Font {
    Font.system(size: tamano, weight: peso, design: .rounded)
}

func textoKm(_ metros: Double) -> String {
    String(format: "%.2f km", max(0, metros) / 1000).replacingOccurrences(of: ".", with: ",")
}

func textoDuracion(_ segundos: Int) -> String {
    let s = max(0, segundos)
    let h = s / 3600, m = (s % 3600) / 60, r = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%02d:%02d", m, r)
}

extension SalchiLiveAttributes.ContentState {
    var segundosMeta: Double { Double(max(1, metaMin)) * 60 }
    var finMeta: Date { inicio.addingTimeInterval(segundosMeta) }
    var transcurrido: Double {
        if terminado { return Double(segundos) }
        return max(0, (pausa ?? Date()).timeIntervalSince(inicio))
    }
    var fraccion: Double { min(1, transcurrido / segundosMeta) }
    var cumplido: Bool { transcurrido >= segundosMeta }
}

struct ImagenGoku: View {
    let nombre: String
    var body: some View {
        if let imagen = UIImage(named: nombre) {
            Image(uiImage: imagen).resizable().scaledToFit()
        } else {
            Image(systemName: "pawprint.fill").resizable().scaledToFit().foregroundColor(Paleta.naranja).padding(6)
        }
    }
}

struct GokuCaminando: View {
    let estado: SalchiLiveAttributes.ContentState
    var body: some View {
        ImagenGoku(nombre: estado.terminado ? "\(estado.raza)-cara" : "\(estado.raza)-paso-\(((estado.cuadro % 4) + 4) % 4)")
    }
}

struct CaraGoku: View {
    let raza: String
    var body: some View {
        ZStack {
            Circle().fill(Paleta.amarillo)
            ImagenGoku(nombre: "\(raza)-cara").clipShape(Circle())
        }
    }
}

struct Cronometro: View {
    let estado: SalchiLiveAttributes.ContentState
    var body: some View {
        if estado.terminado {
            Text(textoDuracion(estado.segundos))
        } else {
            Text(timerInterval: estado.inicio...estado.inicio.addingTimeInterval(12 * 3600),
                 pauseTime: estado.pausa, countsDown: false, showsHours: true)
        }
    }
}

struct Carril: View {
    let estado: SalchiLiveAttributes.ContentState
    let perro: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                barra
                Image(systemName: "flag.checkered")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(estado.cumplido ? Paleta.amarillo : .white)
            }
            Text(leyenda)
                .font(redondeada(12.5, .semibold))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(1)
        }
    }

    @ViewBuilder var barra: some View {
        if !estado.terminado && estado.pausa == nil && !estado.cumplido {
            ProgressView(timerInterval: estado.inicio...estado.finMeta, countsDown: false,
                         label: { EmptyView() }, currentValueLabel: { EmptyView() })
                .progressViewStyle(.linear)
                .tint(Paleta.naranja)
        } else {
            ProgressView(value: estado.fraccion)
                .progressViewStyle(.linear)
                .tint(estado.cumplido ? Paleta.amarillo : Paleta.naranja)
        }
    }

    var leyenda: String {
        if estado.terminado { return "¡Paseo terminado! Buen trabajo, \(perro)" }
        if estado.pausa != nil { return "En pausa · mínimo \(estado.metaMin) min" }
        if estado.cumplido { return "¡Mínimo cumplido! Sigan disfrutando" }
        return "Mínimo \(estado.metaMin) min · ¡vamos, \(perro)!"
    }
}

struct VistaBloqueo: View {
    let contexto: ActivityViewContext<SalchiLiveAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack(alignment: .bottom) {
                Ellipse().fill(Color.black.opacity(0.18)).frame(width: 70, height: 9)
                GokuCaminando(estado: contexto.state).frame(width: 96, height: 70).padding(.bottom, 3)
            }
            .frame(width: 96, height: 78)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text((contexto.state.terminado ? "PASEO CON " : "PASEANDO CON ") + contexto.attributes.perro.uppercased())
                        .font(redondeada(12, .heavy))
                        .foregroundColor(.white.opacity(0.85))
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    Text(textoKm(contexto.state.metros))
                        .font(redondeada(15, .bold))
                        .foregroundColor(Paleta.amarillo)
                }
                Cronometro(estado: contexto.state)
                    .font(redondeada(36, .bold).monospacedDigit())
                    .foregroundColor(.white)
                    .multilineTextAlignment(.leading)
                Carril(estado: contexto.state, perro: contexto.attributes.perro)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(LinearGradient(colors: [Paleta.cieloArriba, Paleta.cieloAbajo],
                                   startPoint: .topLeading, endPoint: .bottomTrailing))
    }
}

struct SalchiLiveActividad: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SalchiLiveAttributes.self) { contexto in
            VistaBloqueo(contexto: contexto)
                .activityBackgroundTint(Paleta.cieloArriba)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { contexto in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    GokuCaminando(estado: contexto.state).frame(width: 70, height: 52).padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Cronometro(estado: contexto.state)
                            .font(redondeada(24, .bold).monospacedDigit())
                            .foregroundColor(.white)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 110, alignment: .trailing)
                        Text(textoKm(contexto.state.metros))
                            .font(redondeada(13, .bold))
                            .foregroundColor(Paleta.amarillo)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Carril(estado: contexto.state, perro: contexto.attributes.perro)
                        .padding(.horizontal, 6)
                        .padding(.top, 2)
                }
            } compactLeading: {
                CaraGoku(raza: contexto.state.raza).frame(width: 24, height: 24)
            } compactTrailing: {
                Cronometro(estado: contexto.state)
                    .font(redondeada(14, .bold).monospacedDigit())
                    .foregroundColor(Paleta.naranja)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 52)
            } minimal: {
                CaraGoku(raza: contexto.state.raza).frame(width: 22, height: 22)
            }
            .keylineTint(Paleta.naranja)
        }
    }
}

@main
struct SalchiLiveBundle: WidgetBundle {
    var body: some Widget {
        SalchiLiveActividad()
    }
}
`;

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>es</string>
	<key>CFBundleDisplayName</key>
	<string>Guau Guau</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.widgetkit-extension</string>
	</dict>
</dict>
</plist>
`;

/* ------------------------------------------------------------------------------------------ */
/* Agrega la extensión al proyecto de Xcode (con la gema xcodeproj, la misma de CocoaPods)      */
/* ------------------------------------------------------------------------------------------ */
const RUBY = String.raw`require 'xcodeproj'

app_id = ARGV[0] or abort('Falta el appId')
proyecto = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = proyecto.targets.find { |t| t.name == 'App' } or abort('No encontré el target App')
if proyecto.targets.any? { |t| t.name == 'SalchiLive' }
  puts 'La extensión SalchiLive ya estaba en el proyecto'
  exit 0
end

ext = proyecto.new_target(:app_extension, 'SalchiLive', :ios, '16.2', proyecto.products_group, :swift)

grupo = proyecto.main_group.new_group('SalchiLive', 'SalchiLive')
Dir.children('ios/App/SalchiLive').sort.each do |nombre|
  ref = grupo.new_reference(nombre)
  case File.extname(nombre)
  when '.swift' then ext.source_build_phase.add_file_reference(ref, true)
  when '.png' then ext.resources_build_phase.add_file_reference(ref, true)
  end
end

ajustes_app = app.build_configurations.find { |c| c.name == 'Release' }.build_settings
ext.build_configurations.each do |c|
  b = c.build_settings
  b['PRODUCT_NAME'] = '$(TARGET_NAME)'
  b['PRODUCT_BUNDLE_IDENTIFIER'] = "#{app_id}.live"
  b['INFOPLIST_FILE'] = 'SalchiLive/Info.plist'
  b['GENERATE_INFOPLIST_FILE'] = 'NO'
  b['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  b['SWIFT_VERSION'] = '5.0'
  b['TARGETED_DEVICE_FAMILY'] = '1,2'
  b['SKIP_INSTALL'] = 'YES'
  b['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  b['MARKETING_VERSION'] = ajustes_app['MARKETING_VERSION'] || '1.0'
  b['CURRENT_PROJECT_VERSION'] = ajustes_app['CURRENT_PROJECT_VERSION'] || '1'
  b['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  b['CODE_SIGN_STYLE'] = 'Automatic'
end

app.add_dependency(ext)
fase = app.copy_files_build_phases.find { |f| f.symbol_dst_subfolder_spec == :plug_ins } ||
       app.new_copy_files_build_phase('Embed Foundation Extensions')
fase.symbol_dst_subfolder_spec = :plug_ins
archivo = fase.add_file_reference(ext.product_reference, true)
archivo.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

proyecto.save
puts "Extensión SalchiLive agregada (#{app_id}.live)"
`;

/* ------------------------------------------------------------------------------------------ */

export function prepararPlugin() {
  const base = "plugins/salchi-live";
  escribir(join(base, "package.json"), JSON.stringify({
    name: "salchi-live",
    version: "1.0.0",
    description: "Actividad en vivo de Guau Guau (pantalla bloqueada e isla dinámica)",
    private: true,
    license: "MIT",
    capacitor: { ios: { src: "ios" } }
  }, null, 2) + "\n");
  escribir(join(base, "Package.swift"), PACKAGE_SWIFT);
  escribir(join(base, "ios/Sources/SalchiLivePlugin/SalchiLivePlugin.swift"), PLUGIN_SWIFT);
  escribir(join(base, "ios/Sources/SalchiLivePlugin/SalchiLiveAttributes.swift"), ATRIBUTOS_SWIFT);
  run(`npm install --no-audit --no-fund ./${base}`);
  console.log("Plugin de la actividad en vivo: listo");
}

// Recorta 4 poses de cada perro caminando (de los sprites de la web) y su cara
const RAZAS_WIDGET = [
  { id: "salchicha", sprite: "goku-caminando-sprite.webp", cara: "goku-cara.webp", ancho: 360, alto: 252 },
  { id: "pug", sprite: "pug-caminando-sprite.webp", cara: "pug-cara.webp", ancho: 300, alto: 288 },
  { id: "golden", sprite: "golden-caminando-sprite.webp", cara: "golden-cara.webp", ancho: 340, alto: 274 }
];
export async function crearImagenes(dir, config) {
  try { await import("sharp"); } catch { run("npm install --no-save --no-audit --no-fund sharp@0.35"); }
  const { default: sharp } = await import("sharp");
  const web = String(config.server?.url || "").replace(/\/?$/, "/");
  const COLUMNAS = 6, POSES = [0, 6, 12, 18];
  for (const r of RAZAS_WIDGET) {
    try {
      const respuesta = await fetch(web + r.sprite);
      if (!respuesta.ok) throw new Error(`sprite: HTTP ${respuesta.status}`);
      const sprite = Buffer.from(await respuesta.arrayBuffer());
      for (let i = 0; i < POSES.length; i++) {
        const p = POSES[i];
        await sharp(sprite)
          .extract({ left: (p % COLUMNAS) * r.ancho, top: Math.floor(p / COLUMNAS) * r.alto, width: r.ancho, height: r.alto })
          .resize({ width: 270 })
          .png({ compressionLevel: 9 })
          .toFile(join(dir, `${r.id}-paso-${i}.png`));
      }
      const cara = await fetch(web + r.cara);
      if (!cara.ok) throw new Error(`cara: HTTP ${cara.status}`);
      await sharp(Buffer.from(await cara.arrayBuffer())).resize(120, 120).png({ compressionLevel: 9 }).toFile(join(dir, `${r.id}-cara.png`));
      console.log(`Imágenes de la actividad en vivo (${r.id}): listas`);
    } catch (e) {
      console.warn(`AVISO: no pude crear las imágenes de ${r.id} (${e.message}). Se verá una huella en su lugar.`);
    }
  }
}

function asegurarXcodeproj() {
  const hay = () => {
    try { execSync(`ruby -e "require 'xcodeproj'"`, { stdio: "ignore" }); return true; } catch { return false; }
  };
  if (hay()) return;
  try { run("gem install xcodeproj --no-document --user-install"); } catch { /* probamos con sudo */ }
  if (hay()) return;
  run("sudo gem install xcodeproj --no-document");
}

export async function agregarWidget(config) {
  const dir = "ios/App/SalchiLive";
  escribir(join(dir, "SalchiLiveWidget.swift"), WIDGET_SWIFT);
  escribir(join(dir, "SalchiLiveAttributes.swift"), ATRIBUTOS_SWIFT);
  escribir(join(dir, "Info.plist"), INFO_PLIST);
  await crearImagenes(dir, config);
  asegurarXcodeproj();
  const script = join(tmpdir(), "agregar-widget-salchilive.rb");
  writeFileSync(script, RUBY);
  run(`ruby "${script}" "${config.appId}"`);
}
