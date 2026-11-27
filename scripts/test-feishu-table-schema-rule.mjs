import assert from "node:assert/strict";
import {
  auditManagedProductTableSchemas,
  LISTING_INTAKE_TABLE_NAME,
  PRODUCT_SOURCE_TABLE_NAME,
  resolveManagedProductTables
} from "../dist/src/autolist/feishu-table-schema-rules.js";

const tables = [
  { tableId: "source", tableName: PRODUCT_SOURCE_TABLE_NAME, raw: {} },
  { tableId: "listing", tableName: LISTING_INTAKE_TABLE_NAME, raw: {} }
];
const field = (fieldName, fieldId = fieldName) => ({ fieldId, fieldName, type: 1, raw: {} });
const requiredFieldNames = ["用户认知名", "主图主标题", "主图副标题", "主图卖点"];
const validFields = requiredFieldNames.map((name) => field(name));

const valid = auditManagedProductTableSchemas({
  tables,
  fieldsByTableId: new Map([["source", validFields], ["listing", validFields]]),
  requiredFieldNames
});
assert.equal(valid.ok, true);
assert.throws(() => resolveManagedProductTables(tables.slice(0, 1)), /选品上架表 must resolve exactly once/);

const obsolete = auditManagedProductTableSchemas({
  tables,
  fieldsByTableId: new Map([
    ["source", validFields],
    ["listing", [...validFields.filter((item) => item.fieldName !== "主图卖点"), field("主图指令")]]
  ]),
  requiredFieldNames
});
assert.equal(obsolete.ok, false);
assert.match(obsolete.errors.join("\n"), /obsolete fields: 主图指令/);
assert.match(obsolete.errors.join("\n"), /missing required fields: 主图卖点/);

console.log("Feishu managed table schema rule passed");
