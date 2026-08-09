import { approveReviewedNegativeUncertainPublishRetry } from "../autolist/recover-uncertain-publish.js";

const [runtimeDir, shopFolder] = process.argv.slice(2);
if (!runtimeDir || !shopFolder) {
  throw new Error("Usage: auto-listing-recover-uncertain <publish-runtime-dir> <shop-folder>");
}
console.log(JSON.stringify(await approveReviewedNegativeUncertainPublishRetry({ runtimeDir, shopFolder }), null, 2));
