# Feishu Prompt And Title Source Design

## Goal

Stabilize the auto-listing flow by making Feishu Bitable the source of truth for poster prompts and title keywords.

## Rule Layer

- Poster prompts must come from the Feishu field `DeepSeek提示词`.
- `医疗器械` and `保健食品` records must provide 5 poster prompt paragraphs.
- `非处方药` records must provide 3 poster prompt paragraphs.
- The main flow must not open DeepSeek web pages or submit DeepSeek browser prompts.
- Title keywords must come from the Feishu field `标题关键词`.
- Title generation must use only those Feishu keywords as variable keyword content.
- Medical-device and OTC title prefix/suffix and length rules remain category-specific and unchanged.
- Health-food titles keep the existing 28-character no-fixed-prefix/no-fixed-suffix rule.
- Hermes remains a launcher/status reporter. It must not perform business generation or publishing actions directly.

## Action Layer

- Extend Feishu record normalization to read `DeepSeek提示词` and `标题关键词`.
- Build poster prompt artifacts directly from the Feishu prompt field, then reuse the existing Word-document and image-generation pipeline.
- Build title workbooks directly from deterministic keyword combinations, then reuse the existing distribution and publishing pipeline.
- Remove obsolete DeepSeek and Doubao browser dependencies from the auto-listing main path and update docs/scripts so old rules cannot steer execution.

## Validation

- Add rule checks for Feishu prompt fields, poster prompt paragraph counts, and keyword-only title composition.
- Run build, rule checks, doctors, and a simulated flow before restarting Hermes.
