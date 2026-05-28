import assert from "node:assert/strict";
import {
  assertDeepSeekPromptsBelongToCurrentProduct,
  buildDeepSeekPromptValidationContext,
  classifyDeepSeekPromptParagraph,
  selectDeepSeekLatestReplyPromptBlock,
  shouldRetryDeepSeekPromptSubmission,
  resolveDeepSeekPromptRetryPolicy
} from "../dist/src/autolist/deepseek-prompt-rules.js";

const lipGelContext = buildDeepSeekPromptValidationContext({
  sellingPointText: "适用于唇部干燥护理，保湿润护，医用聚乙二醇润护敷料，官方正品。",
  userCognitionName: "医用唇部保湿凝胶",
  brandedGenericName: "延草纲目医用聚乙二醇润护敷料"
});

assert.deepEqual(resolveDeepSeekPromptRetryPolicy(), {
  maxAttempts: 3
});

assert.equal(
  classifyDeepSeekPromptParagraph(
    "合成生物学洁净室玻璃墙虚化背景,生物反应器半透明轮廓,透明水珠状重组胶原蛋白分子链,面部抽象模型细胞外基质纤维融合,科技蓝光",
    lipGelContext
  ).ok,
  false,
  "Must reject another-product prompt only when it has no current-product anchor."
);

assert.equal(
  classifyDeepSeekPromptParagraph(
    "合成生物学洁净室玻璃墙虚化背景,聚乙二醇分子链悬浮释放水润光粒,10ml管装倾斜挤出凝胶,凝胶与唇部抽象模型融合,细胞外基质纤维背景,官方正品标签",
    lipGelContext
  ).ok,
  true,
  "Must accept returned content when any part matches current product name, generic name, or selling points."
);

assert.equal(
  classifyDeepSeekPromptParagraph(
    "海报场景必须与产品卖点强相关,如持续发热渗透,远红外陶瓷粉,缓解疼痛,不添加科技狠活,正品保证等,不再限定行业",
    lipGelContext
  ).ok,
  false,
  "Must reject copied rule text even if it looks like comma-separated keywords."
);

const validPrompts = [
  "唇部护理特写背景,聚乙二醇凝胶透明质地,保湿润护水光粒子,管装产品居中陈列,官方正品防伪标签,洁净医疗蓝白配色",
  "干燥唇部护理场景,医用唇部保湿凝胶挤出质感,润护敷料成膜水润光泽,柔和高光与玻璃反射,正品保证封签,电商主图构图",
  "唇部保湿日常护理台面,聚乙二醇润护敷料成分标识,透明凝胶水滴纹理,产品包装前景放大,安全承诺图标,白蓝医疗风",
  "医用唇部凝胶使用步骤拆解,保湿润护效果视觉化水雾,凝胶质地微距,产品与说明卡并排,官方正品印章,干净浅色背景",
  "唇部干燥护理主题海报,保湿凝胶管装悬浮展示,聚乙二醇润护敷料标签清晰,水润光粒环绕,防伪标签细节,高转化主图排版"
];

assert.doesNotThrow(() => {
  assertDeepSeekPromptsBelongToCurrentProduct(validPrompts, lipGelContext, 5);
});

assert.doesNotThrow(
  () =>
    assertDeepSeekPromptsBelongToCurrentProduct(
      [
        "膝盖贴膏护理场景,远红外陶瓷粉科技粒子,持续发热渗透光效,缓解疼痛标签,关节部位示意,电商主图构图",
        "海报场景必须与产品卖点强相关,如持续发热渗透,远红外陶瓷粉,缓解疼痛,不添加科技狠活,正品保证等,不再限定行业",
        validPrompts[2],
        "场景元素需丰富,具象,细腻,背景,道具,光线层次,材质纹理,使用步骤拆解特写",
        "不展示人体,骨骼,穴位,疼痛部位,治疗过程,功效渗透,能量进入身体,疾病对比"
      ],
      lipGelContext,
      5
    ),
  "Resume validation should accept a prompt set when any saved paragraph relates to the current product."
);

assert.throws(
  () =>
    assertDeepSeekPromptsBelongToCurrentProduct(
      [
        "膝盖贴膏护理场景,远红外陶瓷粉科技粒子,持续发热渗透光效,缓解疼痛标签,关节部位示意,电商主图构图",
        "海报场景必须与产品卖点强相关,如持续发热渗透,远红外陶瓷粉,缓解疼痛,不添加科技狠活,正品保证等,不再限定行业",
        "场景元素需丰富,具象,细腻,背景,道具,光线层次,材质纹理,使用步骤拆解特写",
        "必须融入产品卖点,成分科学严谨,官方正品,正品保证,匠心甄选,通过视觉元素体现",
        "不展示人体,骨骼,穴位,疼痛部位,治疗过程,功效渗透,能量进入身体,疾病对比"
      ],
      lipGelContext,
      5
    ),
  /does not match current product/
);

assert.equal(shouldRetryDeepSeekPromptSubmission({ extractedPromptCount: 0 }), true);
assert.equal(shouldRetryDeepSeekPromptSubmission({ extractedPromptCount: 1 }), false);
assert.equal(shouldRetryDeepSeekPromptSubmission({ extractedPromptCount: 5 }), false);

const historicalTail = [
  "历史凡士林软膏提示词,重组胶原蛋白,20g管装,唇部护理,旧商品",
  "历史护手霜提示词,手部皮肤护理,50g管装,旧商品"
];
assert.deepEqual(
  selectDeepSeekLatestReplyPromptBlock([...validPrompts, ...historicalTail], 5),
  validPrompts,
  "Latest DeepSeek reply appears before visible conversation history; extraction must select the first complete block."
);
