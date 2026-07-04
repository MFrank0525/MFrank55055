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

const finalSubmitUncertain = recordPublishFailure(state, {
  stage: "publish",
  errorClass: "final_publish_state_uncertain",
  threshold: 2
});
assert.deepEqual(
  finalSubmitUncertain,
  { signature: "publish:final_publish_state_uncertain", consecutive: 1, open: true },
  "A final-submit uncertainty crosses a non-idempotent boundary and must stop the publish batch immediately"
);

const reset = recordPublishFailure(state, { stage: "service", errorClass: "service_section_not_ready", threshold: 3 });
assert.equal(reset.signature, "service:service_section_not_ready");
assert.equal(reset.consecutive, 1);

const shopConfiguration = recordPublishFailure(state, {
  stage: "publish",
  errorClass: "spec_template_configuration_missing",
  threshold: 2
});
assert.deepEqual(
  shopConfiguration,
  { signature: "publish:spec_template_configuration_missing", consecutive: 1, open: true },
  "A missing shop spec template must stop the publish batch immediately so Hermes can report the configuration blocker"
);

console.log("publish failure circuit breaker passed");
