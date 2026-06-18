# Qualification Image Dimension Normalization Design

## Goal

Prevent Doudian detail qualification uploads from failing when a Feishu qualification image exceeds the platform's pixel-dimension limit, while preserving original evidence and supporting existing manifest-backed publish resumes.

## Confirmed Failure

The current Feishu record `recvmScNjpQaiG` contains two qualification images. One is `5534×4141`, while the other is `1655×2338`. In the real publish run, the compliant image was acknowledged and the oversized image was not, producing `acknowledged=1/2` and `failedFileIndex=2`.

## Rule Layer

- A qualification image requires normalization when either decoded dimension is greater than `5000px`.
- The normalized image's longest edge must be `4900px`; the other edge must be calculated proportionally with `floor(originalOtherEdge × 4900 / originalLongestEdge)` so neither dimension can exceed the target.
- Images whose width and height are both at most `5000px` must be reused unchanged and must never be enlarged.
- The source image in the Feishu asset cache and the copy in the distributed product folder are immutable audit evidence and must not be overwritten.
- After normalization, the action must decode the output again and prove that both dimensions are at most `4900px` and greater than zero.
- Dimension probing, decoding, normalization, or output verification failure is a pre-submit hard failure. The publisher must fail closed and must not upload the original oversized image.
- This rule applies only to qualification/detail images. It does not modify generated main images, white-background images, prompts, titles, or paid-image ledgers.

## Action Layer

Add a dedicated qualification-image normalization action backed by the project's existing system-Python/Pillow convention.

For each publish job:

1. Classify the product-folder assets as today.
2. Probe every qualification image before opening or operating the Doudian publish page.
3. Reuse compliant image paths unchanged.
4. For each oversized image, write a deterministic processed copy under the current publish runtime directory, for example `qualification-images-normalized/<source-stem>-max4900.<ext>`.
5. Preserve aspect ratio and source format where Pillow supports it. Apply EXIF orientation before calculating output dimensions.
6. Decode and verify every processed output.
7. Replace only the in-memory `ProductAssets.detailImages` upload paths with the verified processed paths.

The current failed product folders therefore need no destructive migration: their existing oversized copies remain untouched, and the next `resume-real-job` creates compliant runtime copies immediately before upload.

## Runtime and Resume Behavior

- Normalized files belong to the publish runtime and may be regenerated deterministically after a safe pre-submit failure.
- Existing manifest identity, safe-publish skipping, and resume-job product-folder lists remain unchanged.
- The normalization action must complete before browser-side upload begins, so an image-processing failure cannot create a partial Doudian publish side effect.
- The currently requested safe pause remains in force during implementation. Resume occurs only after code, rule closure, doctors, and two audits pass.

## Error Reporting

Errors must identify the source filename and observed dimensions when available. Required classes of messages are:

- dimension probe failed;
- oversized image normalization failed;
- normalized output missing;
- normalized output still exceeds the `4900px` target;
- normalized output has invalid dimensions.

No error path may silently fall back to the oversized source image.

## Verification

Automated coverage must prove:

- `5534×4141` resolves to `4900×3666` using the defined proportional floor calculation;
- `1655×2338` is reused unchanged;
- neither dimension can exceed the target after normalization;
- source files remain byte-identical;
- oversized PNG and JPEG inputs produce verified outputs;
- corrupt or unverifiable images fail closed;
- the publish job uses normalized detail-image paths while leaving other asset groups unchanged;
- existing detail per-file acknowledgement, fail-fast, safe-resume, no-coordinate-click, and final-submit uncertainty tests remain green.

Real verification must inspect the next retry of watermark 01 and require both qualification uploads to be acknowledged before the graphic module proceeds.

## Non-goals

- No lossy recompression of already compliant images.
- No destructive rewrite of Feishu downloads or distributed product folders.
- No broad image optimization pipeline.
- No change to prompt quality, title generation, product matching, or paid image submission behavior.
