// Builds a download-and-double-click Windows package:
//
//   node scripts/package.mjs        (or: npm run package)
//
// Produces release/TarkovStorylineTracker-<version>-windows.zip. Unzipped, it
// has everything it needs, including its own copy of Node, so the person
// running it installs nothing: they double-click "Start Tarkov Tracker.cmd".
// The bundled Node is the one running this script, so the compiled SQLite
// binding in node_modules matches it exactly.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("This package is for Windows (Escape from Tarkov is Windows-only); run it on Windows.");
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const FOLDER = "Tarkov Storyline Tracker";
const RELEASE = join(ROOT, "release");
const STAGE = join(RELEASE, "stage");
const PACKAGE = join(STAGE, FOLDER);
const ZIP = join(RELEASE, `TarkovStorylineTracker-${version}-windows.zip`);

// Only what the running app imports: better-sqlite3 and the two packages it loads its binary with.
const RUNTIME_MODULES = ["better-sqlite3", "bindings", "file-uri-to-path"];

console.log("Compiling...");
execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "inherit" });

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(PACKAGE, "app"), { recursive: true });
mkdirSync(join(PACKAGE, "runtime"), { recursive: true });

const isNeeded = (source) => !/(\.test\.(js|d\.ts)|\.d\.ts|\.map)$/.test(source) && !source.includes("__fixtures__");
cpSync(join(ROOT, "dist"), join(PACKAGE, "app", "dist"), { recursive: true, filter: isNeeded });
cpSync(join(ROOT, "public"), join(PACKAGE, "app", "public"), { recursive: true });
writeFileSync(join(PACKAGE, "app", "package.json"), JSON.stringify({ name: "tarkov-storyline-tracker", version, type: "module" }, null, 2));

for (const name of RUNTIME_MODULES) {
  const from = join(ROOT, "node_modules", name);
  if (!existsSync(from)) {
    throw new Error(`node_modules/${name} is missing - run "npm install" first.`);
  }
  // Skip better-sqlite3's C sources (about 10 MB): only its compiled binding and JS are used.
  cpSync(from, join(PACKAGE, "app", "node_modules", name), {
    recursive: true,
    filter: (source) => !/better-sqlite3[\\/](deps|src)([\\/]|$)/.test(source),
  });
}
if (!existsSync(join(PACKAGE, "app", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"))) {
  throw new Error("better-sqlite3's compiled binding isn't there - run \"npm rebuild better-sqlite3\" and try again.");
}

cpSync(process.execPath, join(PACKAGE, "runtime", "node.exe"));
const nodeLicense = join(dirname(process.execPath), "LICENSE");

const licenses = ["Tarkov Storyline Tracker bundles these open-source components:", ""];
licenses.push(`- Node.js ${process.version} (runtime/node.exe) - MIT license, https://nodejs.org`);
licenses.push("- better-sqlite3 - MIT license, https://github.com/WiseLibs/better-sqlite3 (includes SQLite, public domain)");
licenses.push("- bindings, file-uri-to-path - MIT license", "");
for (const [title, path] of [
  ["better-sqlite3 license", join(ROOT, "node_modules", "better-sqlite3", "LICENSE")],
  ["Node.js license", nodeLicense],
]) {
  if (existsSync(path)) {
    licenses.push(`===== ${title} =====`, readFileSync(path, "utf8").trim(), "");
  }
}
writeFileSync(join(PACKAGE, "THIRD-PARTY-NOTICES.txt"), licenses.join("\r\n"));

const lines = (text) => text.replace(/\r?\n/g, "\r\n");
writeFileSync(
  join(PACKAGE, "Start Tarkov Tracker.cmd"),
  lines(`@echo off
title Tarkov Storyline Tracker (close this window to stop)
cd /d "%~dp0"
rem Your saved progress lives next to this file, in the "data" folder.
set "TARKOV_DATA_DIR=%~dp0data"
"%~dp0runtime\\node.exe" "%~dp0app\\dist\\app.js"
if errorlevel 1 (
  echo.
  echo The tracker could not start. See the message above.
  pause
  exit /b 1
)
`)
);
writeFileSync(join(PACKAGE, "README.txt"), lines(readFileSync(join(ROOT, "scripts", "package-readme.txt"), "utf8").replace("{{VERSION}}", version)));

rmSync(ZIP, { force: true });
console.log("Zipping...");
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${join(STAGE, FOLDER)}' -DestinationPath '${ZIP}' -CompressionLevel Optimal"`, { stdio: "inherit" });
rmSync(STAGE, { recursive: true, force: true });

const size = statSync(ZIP).size;
const sha256 = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
console.log(`\nBuilt ${ZIP}\n  ${(size / 1024 / 1024).toFixed(1)} MB   sha256 ${sha256}`);
