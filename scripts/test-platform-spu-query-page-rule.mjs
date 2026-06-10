import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePlatformSpuQueryPageReadiness,
  isDoudianLoginPageText,
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
    url: "https://fxg.jinritemai.com/login/common",
    bodyText: "抖店 优质流量 自主经营 手机登录 邮箱登录 手机号码 验证码 发送验证码 登录 用户协议 隐私条款",
    visibleInputCount: 2,
    brandInputFound: false,
    spuInputFound: false,
    accountMenuOpen: false,
    loading: false
  }),
  { ready: false, issue: "Doudian login is required before publishing can continue." }
);

assert.equal(
  isDoudianLoginPageText("抖店 优质流量 自主经营 手机登录 邮箱登录 手机号码 验证码 发送验证码 登录 用户协议 隐私条款"),
  true
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

const loginFailureClass = classifyPublishFailure("Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing 延草纲目");
assert.equal(loginFailureClass, "doudian_login_required");
assert.equal(shouldRetryPublishFailure(loginFailureClass, 0), false);

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
