# Feishu Reference Image Media Generate Design

## Goal

The lk888 `media-generate` image provider must generate square product main images by using the Feishu white-background product image as the image-to-image reference.

## Requirements

- Product main-image generation must pass the Feishu white-background product image into the provider's `images` parameter.
- The provider must use `size=1024x1024` square output and `quality=high`.
- The flow must never silently fall back to text-only generation for product main images.
- If no provider-accessible reference URL can be created from the Feishu white-background image, the flow must fail before submitting a paid image task.
- Secrets, bearer tokens, and Feishu temporary URLs must not be committed or printed in normal logs.

## Design

Feishu asset extraction keeps `temporaryUrl` and `downloadUrl` on runtime records for traceability, but direct unauthenticated access to the Feishu attachment URL returns an error. The image generation layer therefore treats the local downloaded Feishu white-background image as the source of truth and uploads it to a short-lived public file host before submitting a paid media-generation task.

`media-generate` request construction requires a public reference URL for product main images. It uploads the current product's local Feishu white-background image to tmpfiles, converts the returned page URL to a direct `/dl/` URL, and builds `params.images` from that direct URL while merging configured media parameters such as `size=1024x1024` and `quality`. The local Feishu image remains the source of truth for cleanup, publishing identity, and archive checks.

If reference upload fails or returns no direct public URL, the flow reports a reference-image accessibility problem and stops instead of generating a prompt-only product image.

## Verification

- Unit/rule check confirms `media-generate` requires and sends `params.images` from a public reference URL created from the Feishu white-background image.
- A single paid test submits one task using a tmpfiles direct URL created from the current Feishu white-background image and verifies the resulting file is a `1024x1024` PNG.
- `npm run build`, `npm run rules:check`, and `npm run doctor:auto-listing` pass.
