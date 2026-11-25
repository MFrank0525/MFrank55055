import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertMainImageSetVisualQuality,
  inspectMainImageSetVisualQuality,
  MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION
} from "../dist/src/autolist/main-image-visual-quality-action.js";
import {
  buildMainImageProductionPrompt,
  buildMainImageVisualDirectionContract,
  MAIN_IMAGE_VISUAL_DIRECTION_VERSION
} from "../dist/src/autolist/main-image-visual-direction-rules.js";
import { getPythonCommand, sanitizePythonRuntimeEnv } from "../dist/src/utils/platform.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "main-image-visual-quality-"));
const fixtureScript = `
from PIL import Image, ImageDraw
from pathlib import Path
import sys
root=Path(sys.argv[1]); root.mkdir(parents=True, exist_ok=True)
mode=sys.argv[2]
colors=[(220,170,60),(225,175,65),(215,160,55),(230,180,70)] if mode=='gold' else [(45,120,210),(65,165,125),(120,80,190),(225,105,100),(70,175,185)]
for index in range(20):
    color=colors[0] if mode=='gold' else colors[index//4]
    image=Image.new('RGB',(800,800),(245,245,240)); draw=ImageDraw.Draw(image)
    draw.rectangle((0,0,800,800),fill=color)
    if mode=='gold':
        draw.rectangle((280,180,520,700),fill=(250,245,235))
    else:
        variant=index%4
        if variant==0:
            draw.rounded_rectangle((80,130,360,700),radius=30,fill=(245,245,240))
            draw.ellipse((430,220,700,490),fill=tuple(max(0,c-35) for c in color))
        elif variant==1:
            draw.ellipse((90,100,500,510),fill=(245,245,240))
            draw.rectangle((520,350,740,720),fill=tuple(max(0,c-35) for c in color))
        elif variant==2:
            draw.polygon([(40,700),(360,90),(760,650)],fill=(245,245,240))
            draw.rectangle((500,80,720,280),fill=tuple(max(0,c-35) for c in color))
        else:
            for stripe in range(0,800,100):
                draw.rectangle((stripe,0,stripe+45,800),fill=(245,245,240))
            draw.ellipse((240,240,560,560),fill=tuple(max(0,c-35) for c in color))
    image.save(root/f'image-{index+1:02}.png')
`;
function createSet(name, mode) {
  const dir = path.join(tempDir, name);
  execFileSync(getPythonCommand(), ["-c", fixtureScript, dir, mode], {
    env: sanitizePythonRuntimeEnv(process.env)
  });
  return fs.readdirSync(dir).sort().map((file) => path.join(dir, file));
}

const goldFiles = createSet("gold", "gold");
const goldReport = await inspectMainImageSetVisualQuality({
  imageFiles: goldFiles,
  reportFile: path.join(tempDir, "gold-report.json"),
  expectedImageCount: 20,
  imagesPerRound: 4
});
assert.equal(goldReport.gateVersion, MAIN_IMAGE_VISUAL_QUALITY_GATE_VERSION);
assert.equal(goldReport.ok, false);
assert.ok(goldReport.issues.some((issue) => issue.code === "warm_gold_overuse"));
await assert.rejects(() => assertMainImageSetVisualQuality({
  imageFiles: goldFiles,
  reportFile: path.join(tempDir, "gold-assert-report.json"),
  expectedImageCount: 20,
  imagesPerRound: 4
}), /main_image_visual_quality_rejected/);

const diverseFiles = createSet("diverse", "diverse");
const diverseReport = await assertMainImageSetVisualQuality({
  imageFiles: diverseFiles,
  reportFile: path.join(tempDir, "diverse-report.json"),
  expectedImageCount: 20,
  imagesPerRound: 4
});
assert.equal(diverseReport.ok, true);

const sceneTexts = ["地点类别：beach。", "地点类别：mountain。", "地点类别：city-street。", "地点类别：vehicle。", "地点类别：park-camping。"];
const directions = Array.from({ length: 5 }, (_, roundIndex) =>
  buildMainImageVisualDirectionContract({ roundIndex, variantIndex: 0, hasFixedFrame: true, sceneText: sceneTexts[roundIndex] })
);
assert.equal(new Set(directions).size, 5);
assert.ok(directions.every((text) => text.includes(MAIN_IMAGE_VISUAL_DIRECTION_VERSION)));
assert.ok(directions.every((text) => /场景优先/.test(text)));
assert.ok(directions.every((text) => /当前轮已经规划的用户需求/.test(text)));
assert.ok(directions.every((text) => /人物、局部、纯商品、步骤、原理、配色和光线均由当前需求决定/.test(text)));
assert.ok(directions.every((text) => /不得为了凑人物、步骤、科技感、纯商品感或指定色彩/.test(text)));
assert.ok(directions.every((text) => /禁止|不得/.test(text)));
assert.ok(directions.every((text) => /需求裁决/.test(text)));
const expectedPaletteDirections = [
  /海水蓝、青绿与珊瑚红/,
  /高山蓝、岩灰与冷杉绿/,
  /城市青蓝、石墨灰与少量霓虹紫/,
  /车内炭灰、冷调蓝与清洁白/,
  /公园草木绿、暮色蓝与帐篷红/
];
directions.forEach((text, roundIndex) => {
  assert.match(text, expectedPaletteDirections[roundIndex]);
  assert.match(text, /背景主导色/);
  assert.match(text, /包装原有暖金色不计入背景配色/);
  assert.match(text, /暖金、米黄、橙棕不得成为大面积背景/);
});
const typographyDirections = Array.from({ length: 5 }, (_, roundIndex) =>
  Array.from({ length: 4 }, (_, variantIndex) =>
    buildMainImageVisualDirectionContract({ roundIndex, variantIndex, hasFixedFrame: true, sceneText: sceneTexts[roundIndex] })
  )
).flat();
assert.equal(new Set(typographyDirections).size, 20);
assert.match(typographyDirections[16], /文字系统17：主标题采用与当前场景协调的动势刷字/);
typographyDirections.forEach((text, index) => {
  assert.match(text, new RegExp(`文字系统${String(index + 1).padStart(2, "0")}`));
  assert.match(text, /主标题/);
  assert.match(text, /副标题/);
  assert.match(text, /卖点/);
});
assert.ok(typographyDirections.every((text) => /其余19张/.test(text)));
const productionPrompt = buildMainImageProductionPrompt({
  basePromptText: "两段产品变量。地点类别：mountain。",
  roundIndex: 1,
  variantIndex: 2,
  hasFixedFrame: true,
  frameContract: "固定图框安全区"
});
assert.match(productionPrompt, /两段产品变量/);
assert.match(productionPrompt, /固定生成契约 single-source-product-poster-v5/);
assert.match(productionPrompt, /用户需求、消费时刻和自然使用关系是画面决策的最高依据/);
assert.match(productionPrompt, /人物、手部、使用部位、纯商品展示、步骤图、材质原理、配色、光线和道具都不是必选项/);
assert.match(productionPrompt, /商品、人物和环境的相对大小按当前需求决定/);
assert.match(productionPrompt, /强制画幅约束/);
assert.match(productionPrompt, /单张完整海报/);
assert.match(productionPrompt, /固定图框安全区/);
assert.match(productionPrompt, /高山蓝、岩灰与冷杉绿/);
assert.match(productionPrompt, /第3张采用中央产品英雄构图/);
assert.throws(
  () => buildMainImageVisualDirectionContract({ roundIndex: 0, variantIndex: 0, hasFixedFrame: true, sceneText: "没有具体地点" }),
  /exactly one scene location concept/
);
const assetsSource = fs.readFileSync("src/autolist/main-image-assets.ts", "utf8");
assert.match(assetsSource, /promptTextByImageIndex: promptVariants/);
assert.match(assetsSource, /assertMainImageSetVisualQuality/);
assert.ok(
  assetsSource.lastIndexOf("await assertMainImageSetVisualQuality") < assetsSource.lastIndexOf("finalizeProductFolders(stagedFiles"),
  "Visual quality must pass before shop product folders are finalized."
);
const orchestratorSource = fs.readFileSync("src/autolist/orchestrator.ts", "utf8");
assert.match(orchestratorSource, /enforceVisualQuality: true/);
