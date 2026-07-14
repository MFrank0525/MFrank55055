import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  requireOpenAiCompatibleImageProvider,
  resolveImageGenerationProvider
} from "../dist/src/autolist/image-generation-provider.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "image-provider-selection-"));
const realJobFile = path.resolve("input/auto-listing.job.provider-contract-real-test.json");
const simulateJobFile = path.resolve("input/auto-listing.job.provider-contract-sim-test.json");

function runNode(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return {
    status: result.status,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n")
  };
}

function writeConfig(name, value) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  return file;
}

const canonicalConfig = {
  provider: "openai-compatible",
  apiUrl: "https://provider.example/v1/videos",
  apiKey: "test-key",
  model: "gpt-image-2",
  mode: "videos-base64"
};

for (const invalidProvider of [undefined, "media-generate", "edits", "generations", "foo", "none"]) {
  assert.throws(
    () => requireOpenAiCompatibleImageProvider(invalidProvider, "Paid provider test"),
    /provider.*openai-compatible/i
  );
  assert.throws(
    () => resolveImageGenerationProvider(invalidProvider, false, "Real job test"),
    /provider.*openai-compatible/i
  );
}
assert.equal(resolveImageGenerationProvider("none", true, "Simulation test"), "none");
assert.equal(resolveImageGenerationProvider("openai-compatible", true, "Simulation test"), "openai-compatible");
assert.equal(requireOpenAiCompatibleImageProvider("openai-compatible", "Paid provider test"), "openai-compatible");

try {
  const invalidCliProvider = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing",
    "--image-generation-provider",
    "foo"
  ]);
  assert.match(
    invalidCliProvider.output,
    /FAIL image generation provider selection:.*openai-compatible/i,
    "doctor must validate the supplied CLI provider instead of hardcoding openai-compatible"
  );

  const missingProviderConfig = writeConfig("missing-provider.json", {
    ...canonicalConfig,
    provider: undefined
  });
  const missingProviderDoctor = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing",
    "--require-image-generation",
    "--image-generation-provider",
    "openai-compatible",
    "--image-generation-config",
    missingProviderConfig
  ]);
  assert.match(
    missingProviderDoctor.output,
    /FAIL OpenAI-compatible image generation config:.*provider.*openai-compatible/i,
    "doctor must reject image config with a missing provider"
  );

  const wrongProviderConfig = writeConfig("wrong-provider.json", {
    ...canonicalConfig,
    provider: "foo"
  });
  const wrongProviderDoctor = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing",
    "--require-image-generation",
    "--image-generation-provider",
    "openai-compatible",
    "--image-generation-config",
    wrongProviderConfig
  ]);
  assert.match(
    wrongProviderDoctor.output,
    /FAIL OpenAI-compatible image generation config:.*provider.*openai-compatible/i,
    "doctor must reject image config with a wrong provider"
  );

  const canonicalConfigFile = writeConfig("canonical.json", canonicalConfig);
  const canonicalDoctor = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing",
    "--require-image-generation",
    "--image-generation-provider",
    "openai-compatible",
    "--image-generation-config",
    canonicalConfigFile
  ]);
  assert.match(
    canonicalDoctor.output,
    /OK OpenAI-compatible image generation config:/,
    "doctor must accept the canonical current provider config"
  );

  fs.writeFileSync(
    realJobFile,
    JSON.stringify({
      input: {
        simulateOnly: false,
        imageGenerationProvider: "foo",
        imageGenerationConfigFile: canonicalConfigFile,
        pauseSignalFile: path.join(tmp, "pause.requested")
      }
    }, null, 2) + "\n",
    "utf8"
  );
  const invalidRealJobDoctor = runNode(["dist/src/cli/doctor.js", "--auto-listing"]);
  assert.match(
    invalidRealJobDoctor.output,
    new RegExp(`FAIL auto-listing job: ${path.basename(realJobFile)}:.*openai-compatible`, "i"),
    "doctor must reject a real job that names an invalid provider"
  );

  const invalidAllowReal = runNode([
    "dist/src/cli/auto-listing.js",
    "--job",
    realJobFile,
    "--allow-real"
  ]);
  assert.notEqual(invalidAllowReal.status, 0);
  assert.match(
    invalidAllowReal.output,
    /image generation provider.*openai-compatible/i,
    "allow-real CLI must reject an invalid paid provider before resolving or running the job"
  );

  fs.writeFileSync(
    simulateJobFile,
    JSON.stringify({ input: { simulateOnly: true, imageGenerationProvider: "none" } }, null, 2) + "\n",
    "utf8"
  );
  const simulationDoctor = runNode(["dist/src/cli/doctor.js", "--auto-listing"]);
  assert.match(
    simulationDoctor.output,
    new RegExp(`OK auto-listing job: ${path.basename(simulateJobFile)}:`),
    "doctor must preserve explicit none for genuine simulation jobs"
  );
} finally {
  fs.rmSync(realJobFile, { force: true });
  fs.rmSync(simulateJobFile, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("image provider selection rule passed");
