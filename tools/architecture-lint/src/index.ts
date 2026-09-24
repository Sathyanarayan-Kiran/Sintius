import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture manifests valid: ${ownership.size} owned tables across ${moduleCount} module(s).`);
}
