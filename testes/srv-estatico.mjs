// Serve os arquivos do app em 8123 para os testes de navegador.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const root = "/home/user/App-Casamento";
const tipos = { html: "text/html", css: "text/css", js: "text/javascript", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", webp: "image/webp", woff2: "font/woff2" };
createServer((req, res) => {
  let p = req.url.split("?")[0].split("#")[0];
  if (p.endsWith("/")) p += "index.html";
  try {
    const dados = readFileSync(root + p);
    res.writeHead(200, { "Content-Type": tipos[p.split(".").pop()] || "text/plain", "Cache-Control": "no-store" });
    res.end(dados);
  } catch { res.writeHead(404); res.end("404"); }
}).listen(8123, () => console.log("estático em 8123"));
