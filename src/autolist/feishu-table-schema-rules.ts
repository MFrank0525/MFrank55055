import type { FeishuBitableField, FeishuBitableTable } from "../feishu/types.js";

export const PRODUCT_SOURCE_TABLE_NAME = "产品信息表";
export const LISTING_INTAKE_TABLE_NAME = "选品上架表";
export const MANAGED_PRODUCT_TABLE_NAMES = [PRODUCT_SOURCE_TABLE_NAME, LISTING_INTAKE_TABLE_NAME] as const;
export const OBSOLETE_MAIN_IMAGE_FIELD_NAMES = ["主图指令", "正向提示词", "反向提示词"] as const;

export interface FeishuTableSchemaAudit {
  ok: boolean;
  tables: Array<{
    tableName: string;
    tableId: string;
    fieldCount: number;
    obsoleteFields: FeishuBitableField[];
    missingRequiredFields: string[];
  }>;
  errors: string[];
}

export function resolveManagedProductTables(tables: FeishuBitableTable[]): FeishuBitableTable[] {
  return MANAGED_PRODUCT_TABLE_NAMES.map((tableName) => {
    const matches = tables.filter((table) => table.tableName === tableName);
    if (matches.length !== 1 || !matches[0].tableId) {
      throw new Error(`Feishu managed table ${tableName} must resolve exactly once; found ${matches.length}.`);
    }
    return matches[0];
  });
}

export function auditManagedProductTableSchemas(input: {
  tables: FeishuBitableTable[];
  fieldsByTableId: ReadonlyMap<string, FeishuBitableField[]>;
  requiredFieldNames: string[];
}): FeishuTableSchemaAudit {
  const managed = resolveManagedProductTables(input.tables);
  const required = [...new Set(input.requiredFieldNames.filter(Boolean))];
  const errors: string[] = [];
  const tableReports = managed.map((table) => {
    const fields = input.fieldsByTableId.get(table.tableId);
    if (!fields) throw new Error(`Feishu fields were not loaded for managed table ${table.tableName}.`);
    const names = new Set(fields.map((field) => field.fieldName));
    const obsoleteFields = fields.filter((field) =>
      OBSOLETE_MAIN_IMAGE_FIELD_NAMES.includes(field.fieldName as typeof OBSOLETE_MAIN_IMAGE_FIELD_NAMES[number])
    );
    const missingRequiredFields = required.filter((fieldName) => !names.has(fieldName));
    if (obsoleteFields.length) {
      errors.push(`${table.tableName} contains obsolete fields: ${obsoleteFields.map((field) => field.fieldName).join(", ")}`);
    }
    if (missingRequiredFields.length) {
      errors.push(`${table.tableName} is missing required fields: ${missingRequiredFields.join(", ")}`);
    }
    return {
      tableName: table.tableName,
      tableId: table.tableId,
      fieldCount: fields.length,
      obsoleteFields,
      missingRequiredFields
    };
  });
  return { ok: errors.length === 0, tables: tableReports, errors };
}
