import assert from "node:assert/strict";
import { runRepresentativeSimulation } from "./run-representative-auto-listing-simulation.mjs";

const evidence = await runRepresentativeSimulation();
assert.equal(evidence.result.ok, true);
assert.equal(evidence.result.tasks.length, 1);
assert.equal(evidence.result.tasks[0].status, "done");
assert.equal(evidence.result.tasks[0].mainImageArtifact.generatedFiles.length, 20);
assert.equal(evidence.result.tasks[0].titleSheetArtifact.generatedFiles.length, 20);
assert.equal(evidence.result.tasks[0].shopDistributionArtifact.distributedFolders.length, 20);
assert.equal(evidence.result.tasks[0].publishArtifact.results.length, 20);
assert.deepEqual(evidence.observedSteps, [
  "selling_points_loaded",
  "poster_prompts_generated",
  "main_images_generated",
  "product_folders_built",
  "titles_generated",
  "titles_distributed",
  "metadata_enriched",
  "qualifications_attached",
  "shop_distributed",
  "published",
  "cleaned"
]);

console.log("representative auto-listing simulation passed");
