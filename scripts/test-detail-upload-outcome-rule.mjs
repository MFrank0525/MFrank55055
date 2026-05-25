import assert from "node:assert/strict";
import {
  evaluateDetailImageCompletion,
  evaluateDetailUploadOutcome
} from "../src/business/publish-from-spu/publish-rules.ts";

const satisfiedFinalCount = evaluateDetailImageCompletion({
  filledFromMain: true,
  qualificationImageCount: 4,
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
  qualificationImageCount: 4,
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

console.log("detail upload outcome rule passed");
