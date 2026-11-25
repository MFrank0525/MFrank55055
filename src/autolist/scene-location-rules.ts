export const SCENE_LOCATION_CONCEPTS = [
  "beach",
  "mountain",
  "city-street",
  "vehicle",
  "park-camping",
  "sports",
  "office",
  "home-care",
  "retail",
  "cafe-patio",
  "kitchen-dining",
  "travel-transit"
] as const;

export type SceneLocationConcept = typeof SCENE_LOCATION_CONCEPTS[number];

const SCENE_LOCATION_GROUPS: ReadonlyArray<{
  name: SceneLocationConcept;
  pattern: RegExp;
}> = [
  { name: "beach", pattern: /\bbeach\b|沙滩|海边|海滩/u },
  { name: "mountain", pattern: /\bmountain\b|登山|山林|山顶|山地/u },
  { name: "city-street", pattern: /\bcity-street\b|商业街|步行街|街区|人行道|办公楼外|城市道路|城市街道|城市广场|露天广场|市集/u },
  { name: "vehicle", pattern: /\bvehicle\b|车内|驾车|驾驶位|汽车内部|挡风玻璃|座舱/u },
  { name: "park-camping", pattern: /\bpark-camping\b|公园|草坪|露营|野餐/u },
  { name: "sports", pattern: /\bsports\b|运动场|网球场|跑步道|健身场/u },
  { name: "office", pattern: /\boffice\b|办公室|工位|书房/u },
  { name: "home-care", pattern: /\bhome-care\b|浴室|洗漱台|梳妆台|卧室|床头柜/u },
  { name: "retail", pattern: /\bretail\b|商场|专柜|货架|购物平台/u },
  { name: "cafe-patio", pattern: /\bcafe-patio\b|咖啡座|咖啡馆|露台|阳台|庭院/u },
  { name: "kitchen-dining", pattern: /\bkitchen-dining\b|厨房|餐桌|餐厅/u },
  { name: "travel-transit", pattern: /\btravel-transit\b|机场|车站|酒店/u }
];

export function isSceneLocationConcept(value: unknown): value is SceneLocationConcept {
  return SCENE_LOCATION_CONCEPTS.includes(value as SceneLocationConcept);
}

export function classifySceneLocationConcepts(text: string): SceneLocationConcept[] {
  return SCENE_LOCATION_GROUPS
    .filter((group) => group.pattern.test(text))
    .map((group) => group.name);
}

export function requireSingleSceneLocationConcept(text: string, label: string): SceneLocationConcept {
  const matches = classifySceneLocationConcepts(text);
  if (matches.length !== 1) {
    throw new Error(`${label} must use exactly one concrete location concept, got ${matches.join(",") || "none"}.`);
  }
  return matches[0];
}
