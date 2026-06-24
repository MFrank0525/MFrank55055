import assert from "node:assert/strict";
import { buildTitlesFromFeishuKeywords, parseFeishuTitleKeywords } from "../dist/src/autolist/title-sheets.js";
import { countTitleCharacters } from "../dist/src/autolist/title-rules.js";

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
  fixedSuffixText: "医用凡士林润唇软膏",
  productCategory: "非处方药",
  titleCount: 20
});
assert.equal(otcTitles.length, 20);
for (const title of otcTitles) {
  assert.ok(countTitleCharacters(title) <= 120);
  assert.ok(title.endsWith("医用凡士林润唇软膏"));
  assert.ok(!title.endsWith("医用凡士林润唇软膏延草纲目"));
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
