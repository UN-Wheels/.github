import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { marked } from "marked";

const here = path.dirname(fileURLToPath(import.meta.url));
const mdPath  = path.join(here, "p4_2b.md");
const cssPath = path.join(here, "pdf-style.css");
const htmlOut = path.join(here, "p4_2b.html");

let md     = readFileSync(mdPath, "utf8");
const css  = readFileSync(cssPath, "utf8");

// Quitar el frontmatter YAML inicial (--- ... ---) para que no aparezca en el PDF.
md = md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

marked.setOptions({ gfm: true, breaks: false });

const baseHref = pathToFileURL(here + path.sep).href;

const body = marked.parse(md);

const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <base href="${baseHref}" />
  <title>UN Wheels — Prototipo 4 (Equipo 2B)</title>
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;

writeFileSync(htmlOut, html, "utf8");
console.log("HTML generado:", htmlOut);
