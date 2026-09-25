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

// Telemetry guardrail (decision D15): only platform/observability and apps/* use OpenTelemetry
// directly; everything else goes through the PII-safe facade.
const OTEL_IMPORT = /(?:from\s+|import\s*\(\s*)["']@opentelemetry\//;
for (const layer of ["modules", "platform"]) {
  for (const file of sourceFiles(resolve(root, layer))) {
    if (/[\\/]platform[\\/]observability[\\/]/.test(file)) continue;
    if (OTEL_IMPORT.test(readFileSync(file, "utf8"))) failures.push(`${relative(root, file)}: import telemetry from platform/observability, not @opentelemetry directly`);
  }
}

// Commercial arithmetic guardrail (decision D5): money uses platform/money, never binary floating
// point. A line may opt out only with an explicit `money-lint: allow <reason>` comment.
const FLOAT_ARITHMETIC = /\bparseFloat\s*\(|\.toFixed\s*\(|\.toPrecision\s*\(|\bMath\.(?:round|floor|ceil|trunc|fround)\s*\(/;
const MONEY_AS_NUMBER = /\b[A-Za-z_$]*(?:amount|price|total|subtotal|tax|balance|discount|fee|cost|charge|refund|credit|debit|money)[A-Za-z]*\??\s*:\s*(?:readonly\s+)?number\b/i;
let arithmeticFiles = 0;
for (const layer of ["apps", "modules", "platform"]) {
  for (const file of sourceFiles(resolve(root, layer))) {
    arithmeticFiles += 1;
    const isTest = /[\\/]tests[\\/]/.test(file);
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (/money-lint:\s*allow\s+\S/.test(line)) return;
      const where = `${relative(root, file)}:${index + 1}`;
      if (!isTest && FLOAT_ARITHMETIC.test(line)) failures.push(`${where}: floating-point rounding/parsing is not allowed; use platform/money Decimal`);
      if (MONEY_AS_NUMBER.test(line)) failures.push(`${where}: monetary values must be Money or Decimal, never number`);
    });
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture manifests valid: ${ownership.size} owned tables across ${moduleCount} module(s); no framework imports outside apps/*; OpenTelemetry only via platform/observability; ${arithmeticFiles} files pass the money guardrail.`);
}
