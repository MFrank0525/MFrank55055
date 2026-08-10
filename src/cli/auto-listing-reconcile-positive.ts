import { reconcilePositiveUncertainPublish } from "../autolist/reconcile-positive-uncertain-publish.js";

const [runtimeDir, shopFolder] = process.argv.slice(2);
if (!runtimeDir || !shopFolder) {
  throw new Error("Usage: auto-listing-reconcile-positive <publish-runtime-dir> <shop-folder>");
}
console.log(JSON.stringify(await reconcilePositiveUncertainPublish({ runtimeDir, shopFolder }), null, 2));
