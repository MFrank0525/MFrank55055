import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../dist/src/utils/platform.js";

const cleaned = sanitizePythonRuntimeEnv({
  PATH: "/usr/bin:/bin",
  PYTHONNOUSERSITE: "1",
  PYTHONPATH: "/foreign/hermes/site-packages",
  PYTHONHOME: "/foreign/python",
  VIRTUAL_ENV: "/foreign/venv",
  CONDA_PREFIX: "/foreign/conda",
  AUTO_LISTING_STARTED_BY: "project-controller"
});

for (const key of ["PYTHONNOUSERSITE", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "CONDA_PREFIX"]) {
  assert.equal(cleaned[key], undefined, `Python subprocess environment must remove inherited ${key}`);
}
assert.equal(cleaned.PATH, "/usr/bin:/bin");
assert.equal(cleaned.AUTO_LISTING_STARTED_BY, "project-controller");
assert.match(
  execFileSync(getPythonCommand(), ["-c", "import PIL; print(PIL.__version__)"], {
    encoding: "utf8",
    env: cleaned
  }).trim(),
  /^\d+\.\d+/,
  "sanitized Hermes-shaped environment must expose the installed Pillow runtime"
);

const controllerSource = fs.readFileSync("src/cli/auto-listing-controller.ts", "utf8");
assert.match(
  controllerSource,
  /env:\s*sanitizePythonRuntimeEnv\(\{[\s\S]*AUTO_LISTING_STARTED_BY:[\s\S]*\}\)/,
  "controller must sanitize inherited Python environment before launching the real flow"
);

for (const file of [
  "src/cli/doctor.ts",
  "src/autolist/local-watermark.ts",
  "src/autolist/main-image-square-action.ts",
  "src/business/publish-from-spu/qualification-image-normalizer.ts"
]) {
  const source = fs.readFileSync(file, "utf8");
  assert.match(
    source,
    /sanitizePythonRuntimeEnv/,
    `Python caller must use the shared sanitized runtime environment: ${file}`
  );
}

console.log("python runtime environment isolation passed");
