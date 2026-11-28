// Sube una compilación a Appetize (iPhone y Android en el navegador) y mantiene el mismo enlace.
// Uso: node scripts/subir-appetize.mjs ios|android <archivo>
// Necesita el secreto APPETIZE_TOKEN en GitHub (Settings → Secrets and variables → Actions).
import { readFileSync, appendFileSync } from "node:fs";
import { basename } from "node:path";

const [plataforma, archivo] = process.argv.slice(2);
const token = process.env.APPETIZE_TOKEN;
if (!token) { console.log("Sin APPETIZE_TOKEN: no se sube a Appetize."); process.exit(0); }
const API = "https://api.appetize.io/v1/apps";
const nota = `guauguau-${plataforma}`;
const encabezados = { "X-API-KEY": token };

// Busca la app que ya subimos antes (por su nota) para actualizarla y no cambiar el enlace
let clave = process.env.APPETIZE_CLAVE || "";
if (!clave) {
  try {
    const r = await fetch(API, { headers: encabezados });
    if (r.ok) {
      const j = await r.json();
      const lista = Array.isArray(j) ? j : (j.data || j.apps || []);
      const app = lista.find((a) => a && a.note === nota && a.platform === plataforma);
      if (app) clave = app.publicKey;
    }
  } catch (e) { console.warn("No pude listar las apps de Appetize:", e.message); }
}

const form = new FormData();
form.append("file", new Blob([readFileSync(archivo)]), basename(archivo));
form.append("platform", plataforma);
form.append("note", nota);
const r = await fetch(clave ? `${API}/${clave}` : API, { method: "POST", headers: encabezados, body: form });
const texto = await r.text();
if (!r.ok) { console.error(`Appetize respondió ${r.status}: ${texto.slice(0, 300)}`); process.exit(1); }
const j = JSON.parse(texto);
const url = `https://appetize.io/app/${j.publicKey}`;
console.log(`${clave ? "Actualizada" : "Creada"} en Appetize (${plataforma}): ${url}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${plataforma === "ios" ? "iPhone" : "Android"} en Appetize\n[Abrir en el navegador](${url})\n\n`);
}
