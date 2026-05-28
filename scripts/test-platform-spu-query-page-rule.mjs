import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePlatformSpuQueryPageReadiness,
  classifyPublishFailure,
  shouldRetryPublishFailure
} from "../src/business/publish-from-spu/publish-rules.ts";

assert.deepEqual(
  evaluatePlatformSpuQueryPageReadiness({
    url: "https://fxg.jinritemai.com/ffa/g/spu-record?type=create",
    bodyText: "平台标品 品牌 SPU 查询 重置",
    visibleInputCount: 3,
    brandInputFound: true,
    spuInputFound: true,
    accountMenuOpen: false,
    loading: false
  }),
  { ready: true, issue: "" }
);

assert.deepEqual(
  evaluatePlatformSpuQueryPageReadiness({
    url: "https://fxg.jinritemai.com/ffa/mshop/account",
    bodyText: "店铺管理 登录账号 子账号 手机号 邮箱 切换组织/店铺 退出",
    visibleInputCount: 2,
    brandInputFound: false,
    spuInputFound: false,
    accountMenuOpen: true,
    loading: false
  }),
  { ready: false, issue: "Platform SPU query page URL is not active." }
);

assert.deepEqual(
  evaluatePlatformSpuQueryPageReadiness({
    url: "https://fxg.jinritemai.com/ffa/g/spu-record?type=create",
    bodyText: "平台标品 品牌 查询",
    visibleInputCount: 2,
    brandInputFound: true,
    spuInputFound: false,
    accountMenuOpen: false,
    loading: false
  }),
  { ready: false, issue: "Platform SPU query controls are incomplete." }
);

const emptySpuInputClass = classifyPublishFailure(
  "SPU input value mismatch after typing. expected=湘械注准20212141816; actual=<empty>"
);
assert.equal(emptySpuInputClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(emptySpuInputClass, 0), true);

const publishSource = fs.readFileSync("src/business/publish-from-spu.ts", "utf8");
assert.match(
  publishSource,
  /evaluatePlatformSpuQueryPageReadiness/,
  "SPU query page readiness must use the rule-layer evaluator instead of loose body-text checks"
);
assert.match(
  publishSource,
  /ensurePlatformSpuQueryPageActive/,
  "SPU query actions must force navigation back to the platform SPU page after shop switching"
);

console.log("platform spu query page rule passed");
