import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  requireOpenAiCompatibleImageProvider,
  resolveImageGenerationProvider
} from "../dist/src/autolist/image-generation-provider.js";
import { buildFallbackSourceJobFromPreflight } from "../dist/src/autolist/unsafe-publish-resume.js";
import { assertAutoListingControllerImageGenerationContract } from "../dist/src/autolist/image-generation-config.js";

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

for (const invalidProvider of [undefined, null, "", "media-generate", "edits", "generations", "foo", "none"]) {
  assert.throws(
    () => requireOpenAiCompatibleImageProvider(invalidProvider, "Paid provider test"),
    /provider.*openai-compatible/i
  );
  assert.throws(
    () => resolveImageGenerationProvider(invalidProvider, false, "Real job test"),
    /provider.*openai-compatible/i
  );
}
for (const missingProvider of [undefined, null, ""]) {
  assert.throws(
    () => resolveImageGenerationProvider(missingProvider, true, "Simulation test"),
    /provider.*openai-compatible.*none/i,
    "simulation must explicitly select openai-compatible or none"
  );
}
assert.equal(resolveImageGenerationProvider("none", true, "Simulation test"), "none");
assert.equal(resolveImageGenerationProvider("openai-compatible", true, "Simulation test"), "openai-compatible");
assert.equal(requireOpenAiCompatibleImageProvider("openai-compatible", "Paid provider test"), "openai-compatible");

try {
  const informationalDoctor = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing"
  ]);
  assert.doesNotMatch(
    informationalDoctor.output,
    /FAIL image generation provider selection:/i,
    "informational auto-listing doctor must not require a CLI provider selection"
  );

  const missingCliProvider = runNode([
    "dist/src/cli/doctor.js",
    "--auto-listing",
    "--require-image-generation"
  ]);
  assert.match(
    missingCliProvider.output,
    /FAIL image generation provider selection:.*openai-compatible/i,
    "real doctor entry must fail closed when --image-generation-provider is omitted"
  );

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
  for (const controllerProvider of [undefined, "foo", "none"]) {
    assert.throws(
      () => assertAutoListingControllerImageGenerationContract({
        simulateOnly: false,
        imageGenerationProvider: controllerProvider,
        imageGenerationConfigFile: canonicalConfigFile
      }, process.cwd()),
      /provider.*openai-compatible/i,
      `real controller selection must reject ${String(controllerProvider)}`
    );
  }
  assert.throws(
    () => assertAutoListingControllerImageGenerationContract({
      simulateOnly: false,
      imageGenerationProvider: "openai-compatible"
    }, process.cwd()),
    /config file is required/i,
    "real controller selection must require an explicit config file"
  );
  assert.doesNotThrow(() => assertAutoListingControllerImageGenerationContract({
    simulateOnly: false,
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile: canonicalConfigFile
  }, process.cwd()));
  assert.doesNotThrow(() => assertAutoListingControllerImageGenerationContract({
    simulateOnly: true,
    imageGenerationProvider: "none"
  }, process.cwd()));
  const canonicalHttpConfigFile = writeConfig("canonical-http.json", {
    ...canonicalConfig,
    apiUrl: "http://provider.example/v1/videos"
  });
  assert.doesNotThrow(() => assertAutoListingControllerImageGenerationContract({
    simulateOnly: false,
    imageGenerationProvider: "openai-compatible",
    imageGenerationConfigFile: canonicalHttpConfigFile
  }, process.cwd()));
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

  for (const [name, invalidConfig] of [
    ["missing-api-url", { ...canonicalConfig, apiUrl: undefined }],
    ["wrong-endpoint", { ...canonicalConfig, apiUrl: "https://provider.example/v1/images" }],
    ["missing-mode", { ...canonicalConfig, mode: undefined }],
    ["missing-model", { ...canonicalConfig, model: undefined }],
    ["wrong-model", { ...canonicalConfig, model: "other-model" }],
    ["hosted-file-url", { ...canonicalConfig, apiUrl: "file://localhost/v1/videos" }],
    ["hostless-file-url", { ...canonicalConfig, apiUrl: "file:///v1/videos" }],
    ["ftp-url", { ...canonicalConfig, apiUrl: "ftp://provider.example/v1/videos" }],
    ["credential-url", { ...canonicalConfig, apiUrl: "https://user:password@provider.example/v1/videos" }]
  ]) {
    const invalidConfigFile = writeConfig(`${name}.json`, invalidConfig);
    const invalidConfigDoctor = runNode([
      "dist/src/cli/doctor.js",
      "--auto-listing",
      "--require-image-generation",
      "--image-generation-provider",
      "openai-compatible",
      "--image-generation-config",
      invalidConfigFile
    ]);
    assert.notEqual(invalidConfigDoctor.status, 0, `doctor must reject ${name}`);
    assert.match(
      invalidConfigDoctor.output,
      /FAIL OpenAI-compatible image generation config:/,
      `doctor must report ${name} as an invalid image generation config`
    );
  }

  for (const preflightProvider of [undefined, "foo", "none"]) {
    const unsafeRuntimeDir = path.join(tmp, `unsafe-${String(preflightProvider)}`);
    fs.mkdirSync(unsafeRuntimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(unsafeRuntimeDir, "preflight.json"),
      JSON.stringify({
        source: {
          feishuProductDataFile: "data/feishu/products.json",
          feishuImageDir: "input/auto-listing/feishu-images",
          mainImageWorkDir: "input/auto-listing/main-images",
          qualificationDir: "input/auto-listing/qualification-images",
          shopRootDir: "input/auto-listing/shops",
          ...(preflightProvider === undefined ? {} : { imageGenerationProvider: preflightProvider }),
          imageGenerationConfigFile: canonicalConfigFile
        }
      }, null, 2) + "\n",
      "utf8"
    );
    assert.throws(
      () => buildFallbackSourceJobFromPreflight(process.cwd(), unsafeRuntimeDir),
      /provider.*openai-compatible/i,
      `unsafe real resume must reject ${String(preflightProvider)} before constructing a job`
    );
  }

  const controllerSource = fs.readFileSync("src/cli/auto-listing-controller.ts", "utf8");
  assert.match(
    controllerSource,
    /const selected = selectCommand\(forceFullFlow\);[\s\S]*assertAutoListingControllerImageGenerationContract\([\s\S]*const child = spawn\(/,
    "controller must validate the selected job provider and config before background spawn"
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
