import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluatePlatformSpuQueryPageReadiness,
  isStablePlatformBrandSelection,
  isDoudianLoginPageText,
  classifyPublishFailure,
  shouldRetryPublishFailure
} from "../dist/src/business/publish-from-spu/publish-rules.js";

assert.equal(
  isStablePlatformBrandSelection("延草纲目", ["", ""]),
  false,
  "Clicking a matching dropdown option is not proof that the brand control committed the selection"
);
assert.equal(
  isStablePlatformBrandSelection("延草纲目", ["延草纲目", ""]),
  false,
  "A brand value that disappears on the second readback must block SPU entry"
);
assert.equal(
  isStablePlatformBrandSelection("延草纲目", ["延草纲目", "延草纲目"]),
  true,
  "The brand gate requires two exact stable control readbacks"
);

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

const emptyBrandInputClass = classifyPublishFailure(
  "Brand input value mismatch after typing. expected=延草纲目; actual=<empty>; selectedOption=延草纲目"
);
assert.equal(emptyBrandInputClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(emptyBrandInputClass, 0), true);

for (const unstableBrandMessage of [
  "Brand selection did not commit after bounded retries. expected=延草纲目; readbacks=<empty> | <empty>; clickedOption=延草纲目",
  "Brand selection was lost after SPU entry before clicking query. expected=延草纲目; beforeSpu=延草纲目; afterSpu=<empty>"
]) {
  const failureClass = classifyPublishFailure(unstableBrandMessage);
  assert.equal(failureClass, "platform_page_not_ready");
  assert.equal(shouldRetryPublishFailure(failureClass, 0), true);
}

const inactivePlatformTabClass = classifyPublishFailure(
  "Platform SPU tab did not become active after click. aria-selected=false"
);
assert.equal(inactivePlatformTabClass, "platform_page_not_ready");
assert.equal(shouldRetryPublishFailure(inactivePlatformTabClass, 0), true);

assert.equal(
  classifyPublishFailure("No visible publish rows found in result table."),
  "spu_query_or_match_failed"
);

const loginFailureClass = classifyPublishFailure("Doudian login required: open the automation browser and scan the QR code with the Doudian app before publishing 延草纲目");
assert.equal(loginFailureClass, "doudian_login_required");
assert.equal(shouldRetryPublishFailure(loginFailureClass, 0), false);

const publishSource = [
  fs.readFileSync("src/business/publish-from-spu.ts", "utf8"),
  fs.readFileSync("src/business/publish-from-spu/platform-spu-query-action.ts", "utf8")
].join("\n");
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
assert.match(
  publishSource,
  /const maxPlatformSpuQueryRetries = 4[\s\S]*context\.newPage\(\)/,
  "SPU query page recovery must open a fresh platform page after repeated incomplete-control states"
);
assert.match(
  publishSource,
  /row\.scrollIntoView\(\{ block: "center", inline: "nearest" \}\)[\s\S]*operationCell\.querySelectorAll\("button, a, \[role='button'\]"\)/,
  "SPU query publish action must scroll the matched table row into view and click the operation-column button by DOM structure"
);
assert.match(
  publishSource,
  /async function clickNextPlatformSpuResultPageByDom[\s\S]*getAttribute\("title"\)[\s\S]*clickable\.click\(\)/,
  "SPU query must navigate result pagination by DOM structure when the exact brand is not on the current page"
);

const queryStart = publishSource.indexOf("async function queryPlatformSpu");
assert.notEqual(queryStart, -1, "queryPlatformSpu function must exist");
const queryEnd = publishSource.indexOf("\nasync function", queryStart + 1);
const querySource = publishSource.slice(queryStart, queryEnd === -1 ? publishSource.length : queryEnd);
assert.match(
  querySource,
  /for \(let resultPageNo = 1; !matched && resultPageNo < 8; resultPageNo \+= 1\)[\s\S]*clickNextPlatformSpuResultPageByDom\(page\)/,
  "SPU query must keep scanning paginated results before declaring brand/spu mismatch"
);
assert.match(
  querySource,
  /setPlatformQueryInputValue\(page, "brand", brand\)[\s\S]*readPlatformQueryInputValue\(page, "brand"\)[\s\S]*setPlatformQueryInputValue\(page, "spu", spu\)[\s\S]*Platform query self-check failed before clicking query[\s\S]*queryButton\.click/,
  "SPU query must fill and verify Feishu brand before filling SPU and clicking query"
);
assert.match(
  publishSource,
  /async function clickPlatformBrandDropdownOption[\s\S]*brandInput\.getBoundingClientRect\(\)[\s\S]*rect\.top < brandRect\.bottom[\s\S]*rect\.left < brandRect\.left[\s\S]*rect\.left > brandRect\.right/,
  "SPU brand dropdown selection must be scoped to options near the brand input, not global page text such as the active shop name"
);
assert.match(
  publishSource,
  /function findPlatformBrandFieldInput[\s\S]*\.ecom-g-form-item[\s\S]*ecom-g-label-wrapper-label[\s\S]*inputs\.length === 1/,
  "SPU brand input must be the unique combobox inside the nearest visible 品牌 form item"
);
assert.doesNotMatch(
  publishSource,
  /function findPlatformBrandFieldInput[\s\S]{0,1400}root = root\.parentElement/,
  "Brand lookup must not climb into a broad ancestor and take another field's first combobox"
);
assert.doesNotMatch(
  publishSource,
  /targetKind === "brand"[\s\S]{0,900}\.sort\(\(a, b\) => a\.y - b\.y \|\| a\.x - b\.x\)\[1\]/,
  "SPU brand input must not rely on the second visible search/combobox input"
);
const setInputStart = publishSource.indexOf("async function setPlatformQueryInputValue");
assert.notEqual(setInputStart, -1, "setPlatformQueryInputValue function must exist");
const setInputEnd = publishSource.indexOf("\nasync function", setInputStart + 1);
const setInputSource = publishSource.slice(setInputStart, setInputEnd === -1 ? publishSource.length : setInputEnd);
assert.match(
  setInputSource,
  /if \(kind === "brand"\)[\s\S]*page\.keyboard\.press\("ControlOrMeta\+A"\)[\s\S]*page\.keyboard\.type\(value[\s\S]*return;/,
  "Brand search must use real keyboard events on the focused brand combobox before selecting its option"
);
assert.doesNotMatch(
  setInputSource,
  /targetKind === "brand"[\s\S]{0,900}setter\?\.call\(target, nextValue\)/,
  "Synthetic value assignment must not be used for the controlled readonly brand combobox"
);
const readInputStart = publishSource.indexOf("async function readPlatformQueryInputValue");
assert.notEqual(readInputStart, -1, "readPlatformQueryInputValue function must exist");
const readInputEnd = publishSource.indexOf("\nasync function", readInputStart + 1);
const readInputSource = publishSource.slice(readInputStart, readInputEnd === -1 ? publishSource.length : readInputEnd);
assert.match(
  readInputSource,
  /selectedNode[\s\S]*ariaValueText/,
  "Brand readback must come from committed select display state"
);
assert.doesNotMatch(
  readInputSource,
  /directValue|input as HTMLInputElement\)\.value/,
  "Uncommitted brand search text must never count as selected-brand readback"
);
assert.match(
  querySource,
  /clickPlatformBrandDropdownOption\(page, brand\)/,
  "SPU query must use the brand-input-scoped dropdown picker for brand selection"
);
assert.match(
  querySource,
  /ensurePlatformSpuTabActive\(page, runtimeDir\)/,
  "SPU query must verify that 平台标品 is the active tab before entering query fields"
);
assert.match(
  publishSource,
  /getByRole\("tab", \{ name: "\\u5E73\\u53F0\\u6807\\u54C1", exact: true \}\)[\s\S]*aria-selected/,
  "SPU query must target the unique platform tab role and confirm its selected state"
);
assert.doesNotMatch(
  querySource,
  /getByText\("\\u5E73\\u53F0\\u6807\\u54C1", \{ exact: true \}\)[\s\S]{0,180}click\([^)]*\)\.catch\(\(\) => \{\}\)/,
  "SPU query must not silently swallow an ambiguous 平台标品 text click"
);
assert.match(
  querySource,
  /!allCandidates\.length && retryNo < maxPlatformSpuQueryRetries[\s\S]*platform-spu-query-no-rows-retry-[\s\S]*queryPlatformSpu\(runtimeDir, brand, spu, shopFolder, retryNo \+ 1\)/,
  "SPU query must retry a verified platform-tab query before treating an empty result table as terminal"
);
assert.doesNotMatch(
  querySource,
  /clickVisibleDropdownOption\(page, brand\)/,
  "SPU query must not use the global dropdown picker for brand selection"
);
assert.match(
  querySource,
  /isStablePlatformBrandSelection\(brand,[\s\S]*brandReadbacks[\s\S]*setPlatformQueryInputValue\(page, "spu", spu\)/,
  "SPU entry must remain blocked until two exact brand-control readbacks confirm a committed selection"
);
assert.match(
  querySource,
  /brandValueAfterSpu[\s\S]*isStablePlatformBrandSelection\(brand, \[brandValueConfirmed, brandValueAfterSpu\]\)[\s\S]*before clicking query/,
  "SPU query must re-read the brand after SPU entry and fail before query if the selection was lost"
);
assert.doesNotMatch(
  querySource,
  /brandOptionConfirmed/,
  "A clicked option label must never substitute for committed brand-control state"
);
assert.doesNotMatch(
  querySource,
  /score|publishButtonIndex|Array\.from\(document\.querySelectorAll\("tr"\)\)\[target\.rowIndex\]/,
  "SPU query row selection must not use scoring or reused row/button indexes"
);

console.log("platform spu query page rule passed");
