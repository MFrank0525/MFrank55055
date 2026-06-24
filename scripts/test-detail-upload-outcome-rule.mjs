import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome
} from "../dist/src/business/publish-from-spu/publish-rules.js";

const satisfiedFinalCount = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 5,
  qualificationImageCount: 4,
  acknowledgedQualificationCount: 4,
  finalDetailCount: 9,
  expectedDetailCount: 9
});

assert.deepEqual(
  evaluateDetailUploadOutcome({
    uploadActionCompleted: false,
    detailRule: satisfiedFinalCount
  }),
  { passed: true, issue: "" }
);

const shortFinalCount = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 5,
  qualificationImageCount: 4,
  acknowledgedQualificationCount: 4,
  finalDetailCount: 8,
  expectedDetailCount: 9
});

assert.deepEqual(
  evaluateDetailUploadOutcome({
    uploadActionCompleted: true,
    detailRule: shortFinalCount
  }),
  {
    passed: false,
    issue: "Detail image count did not reach expected count. expected=9; actual=8"
  }
);

const missingAcknowledgement = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 1,
  finalDetailCount: 8,
  expectedDetailCount: 8
});
assert.deepEqual(missingAcknowledgement, {
  passed: false,
  issue: "Qualification detail upload was not acknowledged per file. expected=2; acknowledged=1; baseline=6; final=8"
});

const fullyAcknowledged = evaluateDetailImageCompletion({
  filledFromMain: true,
  baselineDetailCount: 6,
  qualificationImageCount: 2,
  acknowledgedQualificationCount: 2,
  finalDetailCount: 8,
  expectedDetailCount: 8
});
assert.deepEqual(fullyAcknowledged, { passed: true, issue: "" });

const publishSource = fs.readFileSync("src/business/publish-from-spu/graphic-file-input-action.ts", "utf8");
const uploadStart = publishSource.indexOf("async function uploadDetailImagesByInputCapability");
const uploadEnd = publishSource.indexOf("async function uploadFilesToSectionSlots", uploadStart);
const uploadSource = publishSource.slice(uploadStart, uploadEnd);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u5546\\u54c1\\u8be6\\u60c5"/);
assert.match(uploadSource, /pickBestSectionFileInput\(inputs, "\\u8be6\\u60c5\\u9875"/);
assert.match(uploadSource, /waitForPreviewCount[\s\S]*previousCount \+ 1/);
assert.doesNotMatch(uploadSource, /pickBestFileInput\(inputs, scoreDetailGraphicInput\)/);

console.log("detail upload outcome rule passed");
