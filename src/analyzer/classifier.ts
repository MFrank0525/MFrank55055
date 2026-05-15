const CATEGORY_RULES: Record<string, RegExp> = {
  core: /(凝胶|贴|喷雾|乳膏|膏药|理疗仪|血压计|血糖仪|雾化器|制氧机|测量仪|面膜|护腰|护膝|肩颈贴)/,
  function: /(全自动|语音播报|语音|大屏显示|大屏|便携|热敷|冷敷|远红外|一键测量|测量|播报|蓝牙|记忆功能|精准)/,
  people: /(老人|中老年|成人|儿童|孕妇|家用|家庭|爸妈|父母|学生|上班族)/,
  scene: /(居家|办公室|外出|随身|夜间|运动后|日常监测|家庭常备|居家监测|出差)/,
  spec: /(20g|30g|60g|大容量|便携装|上臂式|臂式|腕式|袋装|盒装|单盒|一盒|家用款)/,
  brand: /(鱼跃|欧姆龙|可孚|九安|海尔|奥克斯|李时珍|云南白药)/,
  risk: /(根治|治愈|最有效|药到病除|医用级|专业级|改善明显|疗效|治疗)/
};

export function classifyTerms(terms: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {
    core: [],
    function: [],
    people: [],
    scene: [],
    spec: [],
    brand: [],
    risk: [],
    modifier: []
  };

  for (const term of terms) {
    let matched = false;
    for (const [key, pattern] of Object.entries(CATEGORY_RULES)) {
      if (pattern.test(term)) {
        result[key].push(term);
        matched = true;
        break;
      }
    }
    if (!matched) result.modifier.push(term);
  }

  return result;
}
