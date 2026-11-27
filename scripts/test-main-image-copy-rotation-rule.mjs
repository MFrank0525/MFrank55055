import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMainImageCopyCandidateDigest,
  digestSelectedMainImageCopy,
  formatSelectedMainImageCopy,
  parseSelectedMainImageCopy,
  selectRotatingMainImageCopy
} from "../dist/src/autolist/main-image-copy-rotation-rules.js";
import {
  commitMainImageCopySelectionsForBatch,
  loadMainImageCopySelectionHistory
} from "../dist/src/autolist/main-image-copy-selection-history.js";

const candidates = {
  headlineCandidateText: "主标题甲\n主标题乙",
  subtitleCandidateText: "副标题甲\n副标题乙",
  sellingPointCandidateText: "官方正品\n卖点一\n卖点二\n卖点三\n卖点四\n卖点五\n卖点六"
};

const first = selectRotatingMainImageCopy({ recordId: "rec-1", ...candidates });
const repeatedPreview = selectRotatingMainImageCopy({ recordId: "rec-1", ...candidates });
assert.equal(repeatedPreview.sellingPointText, first.sellingPointText, "Read-only previews must be deterministic");
assert.equal(parseSelectedMainImageCopy(first.sellingPointText).sellingPoints.includes("官方正品"), false);
assert.equal(first.sellingPointText.split("官方正品").length - 1, 1, "Fixed copy must occur exactly once");
const parsedFirstForReorder = parseSelectedMainImageCopy(first.sellingPointText);
const reorderedFirst = formatSelectedMainImageCopy({
  ...parsedFirstForReorder,
  sellingPoints: [...parsedFirstForReorder.sellingPoints].reverse()
});
assert.equal(digestSelectedMainImageCopy(reorderedFirst), first.selectionDigest, "Selling-point order alone is not a new combination");

const second = selectRotatingMainImageCopy({
  recordId: "rec-1",
  ...candidates,
  history: {
    candidateDigest: first.candidateDigest,
    usedSelectionDigests: [first.selectionDigest],
    lastSelectionText: first.sellingPointText,
    cycle: 1
  }
});
assert.notEqual(second.sellingPointText, first.sellingPointText, "A fresh batch must avoid the prior combination");
const firstParsed = parseSelectedMainImageCopy(first.sellingPointText);
const secondParsed = parseSelectedMainImageCopy(second.sellingPointText);
assert.notEqual(secondParsed.headline, firstParsed.headline, "Rotation should prefer a different headline");
assert.notEqual(secondParsed.subtitle, firstParsed.subtitle, "Rotation should prefer a different subtitle");

const sameRefreshOtherRecord = selectRotatingMainImageCopy({
  recordId: "rec-2",
  ...candidates,
  additionalPreviouslyUsedSellingPointTexts: [first.sellingPointText]
});
assert.notEqual(sameRefreshOtherRecord.sellingPointText, first.sellingPointText, "Records in one refresh must avoid exact collisions");

let rollingHistory;
const cycleSelections = [];
for (let index = 0; index < 25; index += 1) {
  const selected = selectRotatingMainImageCopy({ recordId: "rec-cycle", ...candidates, history: rollingHistory });
  cycleSelections.push(selected.sellingPointText);
  rollingHistory = {
    candidateDigest: selected.candidateDigest,
    usedSelectionDigests: index === 24 ? [selected.selectionDigest] : [
      ...(rollingHistory?.usedSelectionDigests || []),
      selected.selectionDigest
    ],
    lastSelectionText: selected.sellingPointText,
    cycle: selected.cycle
  };
}
assert.equal(new Set(cycleSelections.slice(0, 24)).size, 24, "All combinations must be exhausted before reuse");
assert.ok(cycleSelections.slice(0, 24).includes(cycleSelections[24]), "The next cycle may reuse only after exhaustion");

const changedDigest = buildMainImageCopyCandidateDigest({
  ...candidates,
  headlineCandidateText: `${candidates.headlineCandidateText}\n主标题丙`
});
assert.notEqual(changedDigest, first.candidateDigest, "Editing candidate columns must start a new sequence");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-copy-history-"));
const historyFile = path.join(tempRoot, "history.json");
const records = [{
  recordId: "rec-1",
  sellingPointText: first.sellingPointText,
  mainImageHeadlineCandidateText: candidates.headlineCandidateText,
  mainImageSubtitleCandidateText: candidates.subtitleCandidateText,
  mainImageSellingPointCandidateText: candidates.sellingPointCandidateText
}];
assert.equal(commitMainImageCopySelectionsForBatch({ historyFile, batchFingerprint: "batch-1", records }), true);
assert.equal(commitMainImageCopySelectionsForBatch({ historyFile, batchFingerprint: "batch-1", records }), false);
const history = loadMainImageCopySelectionHistory(historyFile);
assert.equal(history.batches["batch-1"].selections["rec-1"], first.selectionDigest);
assert.deepEqual(history.records["rec-1"].usedSelectionDigests, [first.selectionDigest]);

fs.writeFileSync(historyFile, "{}\n", "utf8");
assert.throws(() => loadMainImageCopySelectionHistory(historyFile), /schemaVersion/);

console.log("main-image copy rotation rule tests passed");
