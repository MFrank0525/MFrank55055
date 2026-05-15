import { assertRuleTextIntegrity } from "../autolist/rule-text.js";

function main(): void {
  assertRuleTextIntegrity();
  process.stdout.write("Rule text integrity check passed.\n");
}

main();
