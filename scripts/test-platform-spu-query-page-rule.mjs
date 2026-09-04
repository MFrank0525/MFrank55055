import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  evaluatePlatformSpuQueryPageReadiness,
  isStablePlatformBrandSelection,
  isDoudianLoginPageText,
  classifyPublishFailure,
  isVerifiedPreSubmitRecoveryFailure,
  shouldRetryPublishFailure
} from "../dist/src/business/publish-from-spu/publish-rules.js";
import {
  extractPlatformSpuRowSpecifications,
  resolveExactPlatformBrandCandidateSequence,
  selectPlatformSpuPublishCandidate
} from "../dist/src/business/publish-from-spu/platform-spu-query-rules.js";
import { readPlatformSpuQueryCandidates } from "../dist/src/business/publish-from-spu/platform-spu-query-action.js";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <table>
      <tbody>
        <tr style="display:none">
          <td>延草纲目/湘械注准20222141671 ID:7674483565291798826</td>
          <td>医疗器械及保健用品</td>
          <td><a>发布商品</a></td>
        </tr>
        <tr>
          <td>延草纲目/湘械注准20222141671 ID:7674483565291798826</td>
          <td>医疗器械及保健用品</td>
          <td><a>详情</a><a>发布商品</a></td>
        </tr>
      </tbody>
    </table>
  `);
  const candidates = await readPlatformSpuQueryCandidates(page, "延草纲目", "湘械注准20222141671");
  assert.equal(candidates.length, 1, "Hidden platform table clones must not duplicate one logical SPU row");
  assert.equal(candidates[0].publishControlActionable, true, "One visible exact row must expose one logical publish action");
  assert.equal(await page.locator(candidates[0].publishActionSelector).count(), 1, "The visible exact publish action must keep one stable DOM identity");
} finally {
  await browser.close();
}

assert.deepEqual(
  resolveExactPlatformBrandCandidateSequence("龙仕康", [
    { brandName: "龙仕康", optionIdentity: "1687557066" },
    { brandName: "龙仕康", optionIdentity: "818197274" },
    { brandName: "龙仕康", optionIdentity: "889642166" },
    { brandName: "龙仕康", optionIdentity: "818197274" },
    { brandName: "龙仕康牌", optionIdentity: "other" }
  ]),
  ["1687557066", "818197274", "889642166"],
  "Exact same-name brand identities must be frozen once in dropdown order and deduplicated by stable option identity"
);

assert.deepEqual(
  extractPlatformSpuRowSpecifications(
    "龙仕康/480丸/锁阳固精丸/国药准字Z22025437 规格：480丸 品牌：龙仕康 生产企业名称：吉林省鑫辉药业有限公司"
  ),
  ["480丸"]
);
assert.deepEqual(
  extractPlatformSpuRowSpecifications(
    "龙仕康/480丸/吉林省鑫辉药业有限公司/锁阳固精丸/国药准字Z22025437/否\n\nID:7538641052859171099\n\n条码:6958989321521\n\n药品>非处方药>补益安神\n品牌：龙仕康\n生产企业名称：吉林省鑫辉药业有限公司\n药品通用名：锁阳固精丸\n药品批准文号：国药准字Z22025437\n是否处方药：否\n规格：480丸\n\n2026/08/04 21:03:27\n\n已上线\n\n详情\n发布商品"
  ),
  ["480丸"],
  "A trailing unlabelled timestamp/status/action column must not become part of the specification"
);

const otcMultiSpecificationRows = ["300丸", "480丸", "6g*12袋", "6g*7袋"].map((specification, index) => ({
  rowId: `row-${index}`,
  exactSpuCell: true,
  exactBrandCell: true,
  rowHasSpu: true,
  rowHasBrand: true,
  publishControlActionable: true,
  rowText: `龙仕康/${specification}/锁阳固精丸/国药准字Z22025437 规格：${specification} 品牌：龙仕康`
}));
assert.deepEqual(
  selectPlatformSpuPublishCandidate(otcMultiSpecificationRows, {
    specificationMatch: "require_exact",
    expectedSpecification: "480丸"
  }),
  { candidateIndex: 1, issue: "" },
  "OTC SPU identity must include the exact Feishu specification"
);
assert.deepEqual(
  selectPlatformSpuPublishCandidate(otcMultiSpecificationRows, {
    specificationMatch: "require_exact",
    expectedSpecification: "360丸"
  }),
  {
    candidateIndex: -1,
    issue: "Platform SPU query found exact brand/SPU rows but none matched Feishu specification exactly: expected=360丸; actual=300丸 | 480丸 | 6g*12袋 | 6g*7袋"
  },
  "A missing OTC specification must advance to the next same-name brand identity instead of picking another specification"
);

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

assert.deepEqual(
  evaluatePlatformSpuQueryPageReadiness({
    url: "https://fxg.jinritemai.com/login/common?extra=target",
    bodyText: "",
    visibleInputCount: 0,
    brandInputFound: false,
    spuInputFound: false,
    accountMenuOpen: false,
    loading: false
  }),
  { ready: false, issue: "Doudian login is required before publishing can continue." },
  "An explicit Doudian login route must fail as login-required even when the page body is unavailable or rendered in an iframe"
);

assert.deepEqual(
  evaluatePlatformSpuQueryPageReadiness({
    url: "https://fxg.jinritemai.com/login/common?extra=target",
    bodyText: "抖店 优质流量 自主经营 请选择店铺 抖店工作台 延草纲目滋补专卖店 子账号 专卖店 正常营业",
    visibleInputCount: 0,
    brandInputFound: false,
    spuInputFound: false,
    accountMenuOpen: false,
    loading: false
  }),
  { ready: false, issue: "Authenticated Doudian shop selection is required." },
  "An authenticated shop chooser must not be misclassified as a logged-out session merely because it remains on /login/common"
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
  "Brand selection was lost after SPU entry before clicking query. expected=延草纲目; beforeSpu=延草纲目; afterSpu=<empty>",
  "Brand candidate selection did not commit. expected=龙仕康; expectedIdentity=1687557066; actualIdentity=<empty>",
  "Brand candidate selection was lost after SPU entry before clicking query. expected=龙仕康; expectedIdentity=1687557066; actualIdentity=<empty>",
  "Platform brand candidate sequence changed during query. brand=龙仕康; expectedIdentity=889642166; available=<none>"
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

assert.deepEqual(
  selectPlatformSpuPublishCandidate([
    {
      rowId: "reviewing-row",
      exactSpuCell: true,
      exactBrandCell: true,
      rowHasSpu: true,
      rowHasBrand: true,
      publishControlActionable: false
    },
    {
      rowId: "online-row",
      exactSpuCell: true,
      exactBrandCell: true,
      rowHasSpu: true,
      rowHasBrand: true,
      publishControlActionable: true
    }
  ], { specificationMatch: "ignore" }),
  { candidateIndex: 1, issue: "" },
  "SPU selection must skip an 审核中 disabled row and choose the unique actionable exact row"
);
assert.deepEqual(
  selectPlatformSpuPublishCandidate([
    {
      rowId: "online-row-a",
      exactSpuCell: true,
      exactBrandCell: true,
      rowHasSpu: true,
      rowHasBrand: true,
      publishControlActionable: true
    },
    {
      rowId: "online-row-b",
      exactSpuCell: true,
      exactBrandCell: true,
      rowHasSpu: true,
      rowHasBrand: true,
      publishControlActionable: true
    }
  ], { specificationMatch: "ignore" }),
  {
    candidateIndex: -1,
    issue: "Platform SPU publish navigation failed before click: 2 actionable exact publish rows are ambiguous."
  },
  "Multiple actionable exact rows must fail closed instead of choosing by DOM order"
);

const publishNavigationClass = classifyPublishFailure(
  "Publish page did not open after query click. No new create page was detected."
);
assert.equal(
  publishNavigationClass,
  "platform_spu_publish_navigation_failed",
  "A verified pre-submit navigation failure must not fall through to unknown_publish_failure"
);
assert.equal(
  shouldRetryPublishFailure(publishNavigationClass, 0),
  true,
  "A verified pre-submit navigation failure is safe for bounded retry"
);
assert.equal(
  isVerifiedPreSubmitRecoveryFailure({
    errorClass: "platform_spu_publish_navigation_failed",
    finalVerifyStatus: "not_checked"
  }),
  true,
  "A classified failure before any final-submit attempt is a safe pending recovery boundary"
);
assert.equal(
  isVerifiedPreSubmitRecoveryFailure({
    errorClass: "final_publish_state_uncertain",
    finalVerifyStatus: "needs_manual_review"
  }),
  false,
  "Final-submit uncertainty must never be downgraded to a safe pending recovery"
);

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
  /getByRole\("button", \{ name: "立即刷新", exact: true \}\)/,
  "Platform SPU data-error recovery must click the exact built-in refresh action"
);
assert.match(
  publishSource,
  /recoverPlatformSpuDataErrorSurface/,
  "Platform SPU readiness must run bounded data-error-surface recovery"
);
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
  /data-auto-listing-platform-spu-publish-action[\s\S]*locator\([\s\S]*\.click\(/,
  "SPU query publish action must mark one verified operation-column control and click it through Playwright"
);
assert.match(
  publishSource,
  /nativeControls = Array\.from\(operationCell\.querySelectorAll\("button, a"\)\)[\s\S]*canonicalControls = \(nativeControls\.length \? nativeControls : roleControls\)/,
  "Nested role elements must collapse to one canonical native publish control"
);
assert.match(
  publishSource,
  /publishControls = canonicalControls[\s\S]*control\.contains\(descendant\)/,
  "Invalid nested anchors in the Doudian table must collapse to the leaf action control"
);
assert.doesNotMatch(
  publishSource,
  /markExactPlatformSpuPublishAction/,
  "Candidate selection and publish clicking must not rescan the table through a second DOM identity model"
);
assert.match(
  publishSource,
  /publishActionSelector[\s\S]*page\.locator\(matched\.publishActionSelector\)/,
  "The selected rule-layer candidate must carry the exact DOM action identity used by Playwright"
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
  /reacquireExactPlatformBrandOptionIdentities[\s\S]*clickedBrandIdentity !== selectedBrandIdentity[\s\S]*setPlatformQueryInputValue\(page, "spu", spu\)[\s\S]*brandValueAfterSpu[\s\S]*clickPlatformSpuQueryButton/,
  "SPU query must freeze and verify the exact brand option identity before filling SPU and querying"
);
assert.match(
  publishSource,
  /discoverExactPlatformBrandOptionIdentities[\s\S]*standard_brand_id[\s\S]*resolveExactPlatformBrandCandidateSequence/,
  "SPU brand dropdown discovery must use stable platform brand identities in exact dropdown order"
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
assert.match(
  readInputSource,
  /classList\.contains\("ecom-g-select"\)/,
  "Brand readback must climb to the exact select root class before looking for the selected-item sibling"
);
assert.doesNotMatch(
  readInputSource,
  /marker\.includes\("ecom-g-select"\)/,
  "Brand readback must not mistake the inner selection-search span for the select root"
);
assert.doesNotMatch(
  readInputSource,
  /directValue|input as HTMLInputElement\)\.value/,
  "Uncommitted brand search text must never count as selected-brand readback"
);
assert.match(
  querySource,
  /clickPlatformBrandDropdownOption\(page, brand, selectedBrandIdentity\)/,
  "SPU query must click the frozen stable brand candidate identity"
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
  /!allCandidates\.length && hasNextBrandCandidate[\s\S]*platform-spu-brand-candidate-[\s\S]*queryPlatformSpu\(runtimeDir, request, shopFolder, retryNo, nextBrandCandidateState\)/,
  "An empty query must advance through the frozen same-name brand identity sequence"
);
assert.doesNotMatch(
  querySource,
  /clickVisibleDropdownOption\(page, brand\)/,
  "SPU query must not use the global dropdown picker for brand selection"
);
assert.match(
  querySource,
  /clickedBrandIdentity !== selectedBrandIdentity[\s\S]*isStablePlatformBrandSelection\(brand, brandReadbacks\)[\s\S]*setPlatformQueryInputValue\(page, "spu", spu\)/,
  "SPU entry must remain blocked until the uniquely targeted brand identity click succeeds and brand text is stable"
);
assert.doesNotMatch(
  querySource,
  /readSelectedPlatformBrandOptionIdentity/,
  "A closed virtualized dropdown must not be treated as a durable selected-identity readback surface"
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
assert.doesNotMatch(
  querySource,
  /button\?\.click\(\)/,
  "The critical publish-page navigation must not use a synthetic in-page HTMLElement.click()"
);
assert.match(
  publishSource,
  /waitForURL\([\s\S]*\/ffa\/g\/create[\s\S]*waitForEvent\("page"/,
  "The navigation state machine must observe both same-tab and popup create-page outcomes"
);
for (const sourceFile of [
  "src/business/publish-from-spu/actions/shop-spu-action.ts",
  "src/business/publish-from-spu/actions/basic-info-action.ts",
  "src/business/publish-from-spu/job.ts"
]) {
  const source = fs.readFileSync(sourceFile, "utf8");
  assert.match(source, /specificationMatch:[\s\S]*expectedSpecification:/, `${sourceFile} must pass the complete Feishu specification query identity`);
}

console.log("platform spu query page rule passed");
