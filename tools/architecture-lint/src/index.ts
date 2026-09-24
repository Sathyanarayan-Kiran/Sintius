import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

interface ModuleManifest {
  readonly name: string;
  readonly ownedTables: readonly string[];
  readonly publishedEvents: readonly string[];
  readonly allowedModuleDependencies: readonly string[];
}

const root = resolve(import.meta.dirname, "../../..");
const modulesDirectory = resolve(root, "modules");
const failures: string[] = [];
const ownership = new Map<string, string>();
let moduleCount = 0;

for (const entry of readdirSync(modulesDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  moduleCount += 1;
  const manifestPath = resolve(modulesDirectory, entry.name, "module.json");
  if (!existsSync(manifestPath)) {
    failures.push(`${entry.name}: module.json is required`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModuleManifest;
  if (manifest.name !== entry.name) failures.push(`${entry.name}: manifest name must match its directory`);
  for (const field of ["ownedTables", "publishedEvents", "allowedModuleDependencies"] as const) {
    if (!Array.isArray(manifest[field])) failures.push(`${entry.name}: ${field} must be an array`);
  }
  for (const table of manifest.ownedTables) {
    const existingOwner = ownership.get(table);
    if (existingOwner !== undefined) failures.push(`${table}: owned by both ${existingOwner} and ${manifest.name}`);
    ownership.set(table, manifest.name);
  }
}

// Transport frameworks belong to apps/*; domain modules and platform packages stay framework-free.
const FRAMEWORK_IMPORT = /(?:from\s+|import\s*\(\s*)["'](?:fastify|@fastify\/[^"']+)["']/;
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}
for (const layer of ["modules", "platform"]) {
  for (const file of sourceFiles(resolve(root, layer))) {
    if (FRAMEWORK_IMPORT.test(readFileSync(file, "utf8"))) failures.push(`${relative(root, file)}: HTTP framework imports are only allowed under apps/*`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture manifests valid: ${ownership.size} owned tables across ${moduleCount} module(s); no framework imports outside apps/*.`);
}
