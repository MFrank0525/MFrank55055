import assert from "node:assert/strict";
import fs from "node:fs";

const packageSource = fs.readFileSync("package.json", "utf8");
const cliFiles = fs.readdirSync("src/cli");

for (const command of [
  "auto-listing:hermes-start",
  "auto-listing:hermes-rerun-current-batch",
  "auto-listing:hermes-start:dry",
  "auto-listing:hermes-status",
  "auto-listing:pause"
]) {
  assert.match(
    packageSource,
    new RegExp(`"${command}":\\s*"[^"]*auto-listing-controller\\.js`),
    `${command} must be a thin alias to the project-owned auto-listing controller`
  );
}

assert.match(
  packageSource,
  /"auto-listing:hermes-pause":\s*"npm run auto-listing:pause"/,
  "Hermes pause command must be a thin alias to the project-owned pause entry"
);

assert.equal(
  cliFiles.some((file) => /^hermes-auto-listing-(runner|supervisor)\.ts$/.test(file)),
  false,
  "Hermes-named CLI implementations must not own project execution logic"
);
assert.equal(
  ["dist/src/cli/hermes-auto-listing-runner.js", "dist/src/cli/hermes-auto-listing-supervisor.js"].some((file) =>
    fs.existsSync(file)
  ),
  false,
  "obsolete built Hermes execution paths must not remain runnable"
);

const controllerSource = fs.readFileSync("src/cli/auto-listing-controller.ts", "utf8");
assert.match(
  controllerSource,
  /auto-listing-supervisor\.js/,
  "the project-owned controller must launch the project-owned supervisor"
);
assert.doesNotMatch(
  controllerSource,
  /hermes-auto-listing-supervisor\.js/,
  "the project-owned controller must not launch a Hermes-owned supervisor"
);

console.log("hermes thin entry rule passed");
