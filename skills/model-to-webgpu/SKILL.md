---
name: model-to-webgpu
description: Convert any ML model (ONNX, GGUF, TFLite) into a standalone browser project with hand-written WGSL compute shaders. Zero runtime dependencies. 9-phase methodology from model inspection through iPhone-optimized production to npm publish. Includes starter templates for shaders, engine, activation matching, and build config.
---

# model-to-webgpu

Convert any ML model into a standalone browser project with hand-written WGSL compute shaders. No runtime framework, no ONNX Runtime, no transformers.js. Zero dependencies.

## When to Use This Skill

Use when a user wants to:

- Run an ML model in the browser via WebGPU with zero dependencies
- Port ONNX, GGUF, or TFLite models to pure WebGPU with hand-written WGSL shaders
- Build the smallest possible bundle for browser ML inference (8-12KB gzipped vs 2-5MB frameworks)
- Understand how to write WGSL compute shaders for ML operations (matmul, softmax, attention, convolution)
- Debug WebGPU inference issues (activation matching, numerical stability, iOS Safari compatibility)

## What This Skill Provides

### 9-Phase Methodology (`METHODOLOGY.md`)

1. **Inspect** — Understand model graph, ops, weights, quantization
2. **Extract** — Extract weights, build preprocessing pipeline
3. **Reference** — Generate ground-truth activations for validation
4. **Shaders** — Write all WGSL compute shaders (matmul, norm, attention, conv, etc.)
5. **Engine** — Build forward pass orchestrator with command encoder batching
6. **Validate** — Match WebGPU output to reference activations
7. **Optimize** — Fused shaders, tiled matmul, GPU migration of CPU ops
8. **Mobile** — iPhone Safari hardening (device loss, f16 fallback, submission limits)
9. **Publish** — npm package with CDN-hosted weights

### GitHub Pages Demo

When publishing a package that includes a browser demo (e.g. `demo/index.html`), the demo typically imports from `./dist/index.js`. This means the built output **must be committed to git** for the demo to work on GitHub Pages.

#### Keep dist/ in Git (CRITICAL)

The demo HTML imports directly from `./dist/index.js`. If `dist/` is in `.gitignore` or removed from git, the GitHub Pages demo will break with a 404 on the JS import. **Do not add `dist/` to `.gitignore`** for projects that serve demos from GitHub Pages.

If `dist/` was previously removed:
```bash
# Re-add dist/ to git
git add dist/ -f
git commit -m "Add dist/ back — required for GitHub Pages demo"
```

#### gh-pages Branch Setup

```bash
# Option 1: Deploy from main branch (simplest)
# Go to repo Settings → Pages → Source: "Deploy from a branch" → main → / (root)

# Option 2: Use gh-pages branch
git checkout --orphan gh-pages
git reset --hard
git checkout main -- demo/ dist/ weights/ package.json
git add -A && git commit -m "GitHub Pages deploy"
git push origin gh-pages
# Then set Pages source to gh-pages branch in repo settings
```

#### Verify Deployment

After enabling Pages, the demo is available at:
```
https://<username>.github.io/<repo-name>/demo/
```

Check the deployment status at:
```
https://github.com/<username>/<repo-name>/settings/pages
```

#### Common Gotchas

- **Removing `dist/` from git breaks the demo** — the #1 cause of broken GitHub Pages demos. The HTML imports `./dist/index.js` directly, so it must be checked in.
- **`.gitignore` containing `dist/`** — remove that line or use `git add -f dist/` to override.
- **Stale dist/** — after changing source code, rebuild and commit `dist/` again before pushing.
- **Weight files too large for git** — host weights on a CDN (GCS, S3, unpkg) and load them via fetch, not from the repo. Only JS/WASM build artifacts belong in `dist/`.
- **Mixed content on HTTPS** — GitHub Pages serves over HTTPS; ensure weight URLs also use HTTPS.

### Starter Templates (`templates/`)

- **Model inspectors** for ONNX, GGUF, TFLite (Python with uv shebang)
- **Activation dumper** for generating reference data
- **Shader library** with matmul, layerNorm, softmax, GELU, embedding lookup
- **Engine skeleton** with init sequence, batching, device loss handling
- **Public API** template (loadModel, infer, destroy)
- **Weight loader** with blob fetch + Range request streaming
- **Playwright test** for WebGPU activation matching
- **Build config** (tsup, tsconfig, package.json — zero dependencies)

### Known Bug Database (`KNOWN_BUGS.md`)

28 documented failure modes with symptom → cause → fix:
- Weight layout errors, missing dequantization, varint parsing
- NaN propagation, buffer flag issues, f16 silent failures
- Vision-specific: iOS video input, coordinate math, ROI tracking, bilinear sampling
- TFLite nested models: output head disambiguation, double-sigmoid masking
- Error magnitude guide for quick triage

## Key Patterns

### Shader Template
```wgsl
struct Params { M: u32, N: u32 }
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.M) { return; }
  // Shader logic here
  output[idx] = result;
}
```

### Numerical Stability
```wgsl
let safe_x = clamp(x, -88.0, 88.0);  // exp() overflow guard
let safe_t = clamp(x, -44.0, 44.0);  // tanh/sigmoid guard
```

### iOS Safari
- Flush every ~20-30 dispatches (iOS crashes on 100+)
- Validate f16 with two-pass compute test at init
- Handle device loss with full re-initialization
- Use `createImageBitmap(video)` for video input — `copyExternalImageToTexture` silently returns garbage from HTMLVideoElement on iOS
- Overlap `createImageBitmap` with pipelined readback await for ~10% speedup

## Reference Implementations

| Project | Type | Format | Bundle | Performance |
|---------|------|--------|--------|-------------|
| webgpu-gemma | LLM (1B) | GGUF Q8_0 | 12KB gz | 59.8 tok/s |
| kitten-tts-webgpu | TTS (80M) | ONNX | 753KB gz | 3.3x realtime |
| micro-handpose | Vision | TFLite | 8KB gz | 2.2ms |
| micro-facemesh | Vision (face + iris) | TFLite | 14KB gz | 3.3ms |
