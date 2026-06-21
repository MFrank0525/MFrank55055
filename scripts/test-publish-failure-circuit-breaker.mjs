import assert from "node:assert/strict";
import { recordPublishFailure } from "../dist/src/autolist/failure-circuit-breaker.js";

let state = { signature: "", consecutive: 0, open: false };
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
assert.equal(state.open, false);
state = recordPublishFailure(state, { stage: "detail", errorClass: "detail_image_count_mismatch", threshold: 3 });
assert.equal(state.open, true);

const external = recordPublishFailure(state, {
  stage: "image_provider",
  errorClass: "external_service_unavailable",
  threshold: 3
});
assert.deepEqual(external, { signature: "", consecutive: 0, open: false });

const reset = recordPublishFailure(state, { stage: "service", errorClass: "service_section_not_ready", threshold: 3 });
assert.equal(reset.signature, "service:service_section_not_ready");
assert.equal(reset.consecutive, 1);

console.log("publish failure circuit breaker passed");
