import fs from "node:fs";
import path from "node:path";

const files = ["js/engine.js", "js/storage.js", "js/stats.js", "js/app.js"];

const chunks = files.map((file) => {
  const src = fs.readFileSync(path.resolve(file), "utf8");
  return src
    .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s+(?=(const|let|var|function|async\s+function)\b)/gm, "");
});

const out = `/* Auto-generated bundle for file:// and http(s):// compatibility */\n(function () {\n"use strict";\n\n${chunks.join("\n\n")}\n})();\n`;

fs.writeFileSync(path.resolve("js/bundle.js"), out, "utf8");
console.log("Built js/bundle.js (" + out.length + " bytes)");

