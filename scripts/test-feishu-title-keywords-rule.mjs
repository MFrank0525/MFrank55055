import assert from "node:assert/strict";
import { buildTitlesFromFeishuKeywords, parseFeishuTitleKeywords } from "../dist/src/autolist/title-sheets.js";
import { countTitleCharacters } from "../dist/src/autolist/title-rules.js";

const keywords = parseFeishuTitleKeywords(
  "唇部护理,保湿凝胶,聚乙二醇,润护敷料,干燥护理,水润修护,透明凝胶,医用敷料,唇周护理,正品护理,日常护理,管装凝胶,温和润护,唇部,润护,水润"
);
assert.deepEqual(keywords.slice(0, 3), ["唇部护理", "保湿凝胶", "聚乙二醇"]);

const medicalTitles = buildTitlesFromFeishuKeywords({
  keywordText: keywords.join(","),
  brand: "延草纲目",
  genericName: "医用聚乙二醇润护敷料",
  productCategory: "医疗器械",
  titleCount: 20
});
assert.equal(medicalTitles.length, 20);
assert.equal(new Set(medicalTitles).size, 20);
for (const title of medicalTitles) {
  assert.ok(countTitleCharacters(title) <= 58);
  assert.match(title, /^(医用级|正品|官方正品)/);
  assert.ok(title.endsWith("医用聚乙二醇润护敷料延草纲目"));
}

const otcTitles = buildTitlesFromFeishuKeywords({
  keywordText: keywords.join(","),
  brand: "延草纲目",
  genericName: "医用凡士林润唇软膏",
  productCategory: "非处方药",
  titleCount: 20
});
assert.equal(otcTitles.length, 20);
for (const title of otcTitles) {
  assert.ok(countTitleCharacters(title) <= 58);
  assert.ok(title.endsWith("医用凡士林润唇软膏"));
  assert.ok(!title.endsWith("医用凡士林润唇软膏延草纲目"));
}

const healthTitles = buildTitlesFromFeishuKeywords({
  keywordText: "蓝莓叶黄素,成人护眼,叶黄素酯,维生素营养,每日营养,清晰视界,护眼营养片,便携装,营养补充,蓝莓精华",
  brand: "延草纲目",
  genericName: "蓝莓叶黄素酯片",
  productCategory: "保健食品",
  titleCount: 20
});
assert.equal(healthTitles.length, 20);
for (const title of healthTitles) {
  assert.ok(countTitleCharacters(title) <= 28);
  assert.doesNotMatch(title, /^(医用级|正品|官方正品)/);
}

const shortTitles = buildTitlesFromFeishuKeywords({
  keywordText: "蓝莓叶黄素,成人护眼,叶黄素酯",
  brand: "延草纲目",
  genericName: "蓝莓叶黄素酯片",
  productCategory: "保健食品",
  titleCount: 3
});
assert.equal(shortTitles.length, 3);
for (const title of shortTitles) {
  assert.ok(countTitleCharacters(title) <= 28);
}
