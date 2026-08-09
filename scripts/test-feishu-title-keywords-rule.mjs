import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTitlesFromFeishuKeywords,
  parseFeishuTitleKeywords,
  regenerateDistributedTitleWorkbooks
} from "../dist/src/autolist/title-sheets.js";
import { readWorkbookRows, writeSimpleWorkbook } from "../dist/src/autolist/xlsx-lite.js";
import { auditDistributedTitleArtifacts } from "../dist/src/autolist/audit-rules.js";
import {
  assertTitlePreservesFeishuFixedSuffix,
  countTitleCharacters,
  normalizeFeishuTitleFixedSuffix
} from "../dist/src/autolist/title-rules.js";

const keywords = parseFeishuTitleKeywords(
  "唇部护理,保湿凝胶,聚乙二醇,润护敷料,干燥护理,水润修护,透明凝胶,医用敷料,唇周护理,正品护理,日常护理,管装凝胶,温和润护,唇部,润护,水润"
);
assert.deepEqual(keywords.slice(0, 3), ["唇部护理", "保湿凝胶", "聚乙二醇"]);

const medicalTitles = buildTitlesFromFeishuKeywords({
  keywordText: keywords.join(","),
  fixedSuffixText: "医用聚乙二醇润护敷料",
  productCategory: "医疗器械",
  titleCount: 20
});
assert.equal(medicalTitles.length, 20);
assert.equal(new Set(medicalTitles).size, 20);
for (const title of medicalTitles) {
  assert.ok(countTitleCharacters(title) <= 120);
  assert.ok(countTitleCharacters(title) >= 100);
  assert.doesNotMatch(title, /^(医用级|官方正品)/);
  assert.ok(title.endsWith("医用聚乙二醇润护敷料"));
  assert.equal(title.includes("医用聚乙二醇润护敷料延草纲目"), false);
}

const otcTitles = buildTitlesFromFeishuKeywords({
  keywordText: keywords.join(","),
  fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
  productCategory: "非处方药",
  titleCount: 20
});
assert.equal(otcTitles.length, 20);
for (const title of otcTitles) {
  assert.ok(countTitleCharacters(title) <= 120);
  assert.ok(title.endsWith("锁阳固精丸北方经开9g*10丸"));
  assert.equal((title.match(/\*/g) || []).length, 1, "OTC dosage separator must be preserved exactly once");
  assertTitlePreservesFeishuFixedSuffix({
    title,
    fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
    productCategory: "非处方药"
  });
}
assert.equal(normalizeFeishuTitleFixedSuffix(" 锁阳固精丸北方经开9g*10丸 "), "锁阳固精丸北方经开9g*10丸");
assert.throws(
  () =>
    assertTitlePreservesFeishuFixedSuffix({
      title: "补肾固精锁阳固精丸北方经开9g10丸",
      fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
      productCategory: "非处方药"
    }),
  /fixed suffix|固定后缀|\*/i
);

const repairRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otc-title-regeneration-"));
try {
  const productFolders = Array.from({ length: 20 }, (_, index) => {
    const folder = path.join(repairRoot, `product-${String(index + 1).padStart(2, "0")}`);
    fs.mkdirSync(folder, { recursive: true });
    writeSimpleWorkbook(path.join(folder, "title.xlsx"), [
      ["字段", "内容"],
      ["标题", `旧标题${index + 1}锁阳固精丸北方经开9g10丸`],
      ["导购短标题", "BF锁阳固精丸"],
      ["品牌", "北方经开"],
      ["SPU信息", "国药准字Z22025007"],
      ["型号规格", ""],
      ["产品价格", "189,169,119.9,99.9"]
    ]);
    return folder;
  });
  const repaired = regenerateDistributedTitleWorkbooks({
    productFolders,
    keywordText: keywords.join(","),
    fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
    productCategory: "非处方药",
    productPriceText: "189,169,119.9,99.9"
  });
  assert.equal(repaired.generatedFiles.length, 20);
  const auditedTitles = [];
  for (const [index, file] of repaired.generatedFiles.entries()) {
    const rows = readWorkbookRows(file.workbookFile);
    auditedTitles.push(rows[1][1]);
    assert.equal(rows[1][1], file.title);
    assert.ok(rows[1][1].endsWith("锁阳固精丸北方经开9g*10丸"));
    assert.equal(rows[2][1], "BF锁阳固精丸", `metadata must survive title repair at ${index + 1}`);
    assert.equal(rows[4][1], "国药准字Z22025007");
  }
  assert.equal(auditDistributedTitleArtifacts({
    tasks: [{
      taskId: "image-001",
      productCategory: "非处方药",
      fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
      expectedCount: 20,
      titles: auditedTitles
    }]
  }).ok, true);
  const missingAsteriskAudit = auditDistributedTitleArtifacts({
    tasks: [{
      taskId: "image-001",
      productCategory: "非处方药",
      fixedSuffixText: "锁阳固精丸北方经开9g*10丸",
      expectedCount: 20,
      titles: auditedTitles.map((title, index) => index === 4 ? title.replace("*", "") : title)
    }]
  });
  assert.equal(missingAsteriskAudit.ok, false);
  assert.ok(missingAsteriskAudit.errors.some((error) => error.code === "title_fixed_suffix_not_preserved"));
} finally {
  fs.rmSync(repairRoot, { recursive: true, force: true });
}

const healthTitles = buildTitlesFromFeishuKeywords({
  keywordText: "蓝莓叶黄素,成人护眼,叶黄素酯,维生素营养,每日营养,清晰视界,护眼营养片,便携装,营养补充,蓝莓精华",
  fixedSuffixText: "",
  productCategory: "保健食品",
  titleCount: 20
});
assert.equal(healthTitles.length, 20);
for (const title of healthTitles) {
  assert.ok(countTitleCharacters(title) <= 60);
  assert.doesNotMatch(title, /^(医用级|官方正品)/);
  assert.ok(!title.endsWith("蓝莓叶黄素酯片"));
}

const shortTitles = buildTitlesFromFeishuKeywords({
  keywordText: "蓝莓叶黄素,成人护眼,叶黄素酯",
  fixedSuffixText: "",
  productCategory: "保健食品",
  titleCount: 3
});
assert.equal(shortTitles.length, 3);
for (const title of shortTitles) {
  assert.ok(countTitleCharacters(title) <= 60);
  assert.ok(!title.endsWith("蓝莓叶黄素酯片"));
}

const realLipCareKeywordText =
  "医用凡士林唇部膏，医用凡士林润唇部膏保湿滋润，医用唇部膏保湿滋润补水，唇部膏男士，唇部夏天炎热专用，润唇部膏保湿滋润补水，医用女士润唇部膏男士唇部膏，医用保湿唇部膏，医用润唇保湿敷料，医用润唇部凝胶，医用润唇部霜，医用唇部护理凝胶，胶原蛋白唇部膏，医用凡士林唇部膏，医用凡士林唇部膏无色滋润补水，医用唇部凝胶，医用唇部滋润凝胶，医用唇部敷料，唇部护理软膏男士女士专用，唇部保湿补水凝胶，医用凡士林唇部软膏";
const realLipCareSuffix = "医用重组胶原蛋白护理软膏延草纲目";
const realLipCareKeywords = parseFeishuTitleKeywords(realLipCareKeywordText);
const isComposedOnlyFromKeywords = (body) => {
  const reachable = new Set([0]);
  for (let offset = 0; offset < body.length; offset += 1) {
    if (!reachable.has(offset)) continue;
    for (const keyword of realLipCareKeywords) {
      if (body.startsWith(keyword, offset)) reachable.add(offset + keyword.length);
    }
  }
  return reachable.has(body.length);
};
const realLipCareTitles = buildTitlesFromFeishuKeywords({
  keywordText: realLipCareKeywordText,
  fixedSuffixText: realLipCareSuffix,
  productCategory: "医疗器械",
  titleCount: 20
});
assert.equal(realLipCareTitles.length, 20);
assert.equal(new Set(realLipCareTitles).size, 20);
for (const title of realLipCareTitles) {
  assert.ok(countTitleCharacters(title) <= 120);
  assert.ok(title.endsWith(realLipCareSuffix));
  assert.ok(isComposedOnlyFromKeywords(title.slice(0, -realLipCareSuffix.length)));
}

assert.throws(
  () =>
    buildTitlesFromFeishuKeywords({
      keywordText: "蓝莓叶黄素,成人护眼",
      fixedSuffixText: "",
      productCategory: "医疗器械",
      titleCount: 1
    }),
  /标题固定后缀/
);

const titleManual = fs.readFileSync("docs/auto-listing/steps/05-title-generation.md", "utf8");
const feishuSetupManual = fs.readFileSync("docs/FEISHU_BITABLE_SETUP.md", "utf8");
for (const manual of [titleManual, feishuSetupManual]) {
  assert.match(manual, /医疗器械[\s\S]*非处方药[\s\S]*标题固定后缀/, "medical and OTC title suffix rule must stay documented");
  assert.match(manual, /保健食品[\s\S]*不追加[\s\S]*标题固定后缀/, "health-food title suffix exception must stay documented");
  assert.match(manual, /保健食品[\s\S]*60\s*个?平台字符/, "health-food 60 platform-character limit must stay documented");
  assert.match(manual, /非处方药[\s\S]*\*[\s\S]*保留/, "OTC dosage asterisk preservation must stay documented");
}
