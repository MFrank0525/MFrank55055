import path from "node:path";

export const LEGACY_FIXED_SPEC_VALUES_WITH_EMOJI = [
  "\u2764\u2764\u2764\u5468\u5E74\u5E86\u6D3B\u52A8\u3010\u4E702\u90011\u3011\u5230\u624B3\u76D2\u2764\u2764",
  "\u3010\u65E5\u5E38\u517B\u62A4\u3011\u4E24\u76D2\u88C51.11_11.1",
  "\u3010\u8D35\u5728\u8FD0\u8D39\u3011\u4E00\u76D2\u88C5\u3010\u592A\u4E0D\u5212\u7B97\u3011",
  "\u2764\u2764\u2764\u5468\u5E74\u5E86\u6D3B\u52A8\u3010\u6B63\u88C5\u4E00\u76D2\u3011\u5148\u5230\u5148\u5F97"
];
export const FIXED_SPEC_VALUES = LEGACY_FIXED_SPEC_VALUES_WITH_EMOJI.map((value) => value.replace(/\u2764/g, ""));
export const FIXED_FREIGHT_TEMPLATE_KEYWORD = "\u5ef6\u8349\u8fd0\u8d39";
export const SPEC_TEMPLATE_KEYWORD_DEFAULT = "\u4e70\u4e8c\u9001\u4e00";
export const SPEC_TEMPLATE_KEYWORD_JIUGUANG = "\u4e45\u5149\u5c0f\u6cfd";
export const FIXED_MAIN_IMAGE_DIR = path.resolve(process.cwd(), "input", "fixed-main-images");
export const FEISHU_WHITE_BACKGROUND_IMAGE_DIR = path.resolve(process.cwd(), "input", "auto-listing", "feishu-images");
export const FIXED_MAIN_AUXILIARY_FILES = [
  "\u8f85\u52a9\u56fe02.png",
  "\u8f85\u52a9\u56fe03.png",
  "\u8f85\u52a9\u56fe04.png",
  "\u8f85\u52a9\u56fe05.png"
];
export const REQUIRED_MAIN_IMAGE_RATIO = 1;
export const REQUIRED_MAIN_IMAGE_RATIO_TOLERANCE = 0.02;
export const GRAPHIC_SECTION_LABELS = ["\u4e3b\u56fe", "\u4e3b\u56fe3:4", "\u767d\u5e95\u56fe", "\u5546\u54c1\u8be6\u60c5", "\u8be6\u60c5\u9875"];
export const PLATFORM_SPU_URL =
  "https://fxg.jinritemai.com/ffa/g/spu-record?type=create&btm_ppre=a2427.b76571.c902327.d871297&btm_pre=a2427.b39372.c67909.d0&btm_show_id=1f4fb4cd-7a30-4c1d-8d9c-6250a9e7a466";
