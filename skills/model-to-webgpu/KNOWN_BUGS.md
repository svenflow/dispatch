# model-to-webgpu — Known Bug Database

Reference for Phase 6 activation matching debugging.

| Bug Pattern | Symptom | Root Cause | Fix |
|-------------|---------|------------|-----|
| Wrong weight layout | Early layer diverges by large factor | Weight tensor indexed with wrong stride/dimension order. ONNX DynamicQuantizeLSTM transposes W. TFLite uses NHWC. | Check source format's weight layout docs. Swap indexing. |
| Missing dequantization | All outputs ~100x too large/small | INT8/UINT8 weights uploaded without `(val - zero_point) * scale` | Apply dequant formula during weight extraction |
| Varint parsing error | Specific layers have wrong bias/zero_point | ONNX protobuf packed int32 fields use varint encoding, not raw 4-byte values | Parse varints inside packed repeated fields |
| Missing normalization factor | Error grows multiplicatively through layers | Residual connections missing `/ sqrt(2)`, or embedding missing `* sqrt(hidden_size)` | Check model source for residual scaling conventions |
| Wrong activation function | Shape correct, values systematically wrong | Using ReLU where model uses Snake, or LeakyReLU where model uses PReLU | Trace ONNX graph carefully — names can mislead |
| NaN propagation | All-NaN output after a few layers | `exp()` overflow in GELU/sigmoid/tanh when input >88 | Clamp: tanh/sigmoid to [-44,44], exp to [-88,88] |
| Buffer flag missing | Debug readbacks return all zeros | GPUBuffer without `COPY_SRC` (see Phase 5) | Add `COPY_SRC` to ALL storage buffers |
| Wrong tensor input | Correct shape, wrong values | Feeding wrong intermediate tensor to a component | Trace ONNX graph to confirm exact input tensor |
| Padding asymmetry | Small consistent error in conv layers | TFLite stride-2 SAME padding is asymmetric | Compute asymmetric padding per TFLite's formula |
| Style vector split | Two components produce swapped outputs | Split index wrong (e.g., `[0:128]` vs `[128:256]` swapped) | Check source model's split dimension |
| BN param handling | Conv outputs systematically biased | Using 4 BN params when TFLite fused them into single bias | Check for FusedBatchNormV3 — use fused bias only |
| f16 silent failure | All outputs zero on iOS Safari | `shader-f16` available but complex pipelines produce zeros | Add f16 validation self-test, fallback to f32 |
| Weight key collision | One layer always wrong | Two tensors share same key, Map overwrite | Disambiguate with shape suffix |
| Group conv wrong | Correct shape, wrong channel values | Group/depthwise conv parameter wrong or not implemented | Check group count, implement per-group weight slicing |
| Tied weight duplication | OOM on mobile, 2x expected memory | Embedding and LM head using separate copies of same weights | Share GPUBuffer, don't upload twice |
| workgroupBarrier in branch | Random wrong values, non-deterministic | `workgroupBarrier()` inside divergent `if` block — undefined behavior per WGSL spec | Move ALL barriers outside conditionals, ensure all invocations reach them |
| u32 index overflow | Wrong values for large tensors only | `row * N + col` overflows u32 when tensor has >4B elements | Cast to i32 arithmetic or split into multiple dispatches |
| iOS video input garbage | Vision outputs wildly wrong from video but correct from images | iOS Safari `copyExternalImageToTexture` silently produces garbage from `HTMLVideoElement` | Use `createImageBitmap(video)` — this is the reliable path on iOS Safari |
| FPN upsample half_pixel_centers | Output positions systematically offset, error ~2-3% | Bilinear upsample in FPN missing `half_pixel_centers=true` — coordinates are off by half a pixel | Set `half_pixel_centers=true`: `src_coord = (dst_coord + 0.5) * (src_size / dst_size) - 0.5` |
| Pixel-space vs normalized rotation | Systematic coordinate offset on rotated inputs, ~2-3% error | Computing `atan2` and shift in normalized [0,1] space instead of pixel space. C++ references do rotation math in pixel coords. | Compute atan2 in pixel space. Rotate shift vector in pixel space. Normalize X by imgW and Y by imgH separately. |
| Temporal smoother state leak | 10x inflated error on batch testing / non-sequential inputs | Temporal smoother (one-euro filter, EMA) retains state from previous frame, causing huge error on unrelated inputs | Add `reset()` method to clear smoother state. Call between unrelated inputs. Essential for batch accuracy testing. |
| onSubmittedWorkDone blocking | GPU readback latency higher than necessary | Calling `device.queue.onSubmittedWorkDone()` before reading back results adds unnecessary sync point | Remove `onSubmittedWorkDone()` — use double-buffered pipelined readback instead (`mapAsync` on previous frame's buffer while current frame runs) |
| ROI tracking threshold too high | 0% tracking rate, re-detects every frame | Tracking confidence threshold set too high (e.g., 0.5) — confidence scores are often calibrated lower than expected | Lower tracking threshold (try 0.1). The confidence output may be calibrated differently than you'd expect — check the reference. |
| Shift after square_long | ROI position offset, systematic error on non-square images | Applying center shift AFTER squaring the bounding box to long side. Reference C++ applies shift using original box dimensions BEFORE squaring. | Apply shift BEFORE square_long: `shifted_box = translate(box, shift)` then `squared = square_long(shifted_box)` |
| Manual bilinear vs hardware | Low recall (missed detections), some test images fail | Manual f32 bilinear interpolation in compute shader doesn't match GPU hardware sampling | Use `textureSampleLevel` (hardware GPU bilinear) for image input preprocessing and affine crop. Matches GL_LINEAR exactly. |
| Letterbox offset rounding | ~22% error on some images | Using Math.round or fractional letterbox offsets instead of Math.floor | Use `Math.floor` for letterbox padding offsets — matches C++ integer division behavior |
| TFLite nested model wrong output head | Model "works" but output is meaningless constant | TFLite model with nested sub-models has multiple layers with identical shapes. Outer wrapper layer has extreme bias (e.g., 47.9) producing saturated sigmoid. Inner model layer has small learned bias (e.g., -0.03) and is the real output. | Always inspect bias magnitudes when choosing output heads. Compare against TFLite reference inference. Check model hierarchy paths (e.g., `model_5/model_4/conv2d_151` vs `model_5/conv2d_152`). |
| Double-sigmoid masking correctness | Output looks plausible but is numerically wrong | Sigmoid applied twice (GPU + JS readback). With extreme logits, `sigmoid(sigmoid(huge)) ≈ 0.73` which passes typical 0.5 threshold by coincidence. Removing redundant sigmoid reveals the real bug. | Never apply sigmoid twice. Clean up numerical code aggressively — redundant activations can mask underlying correctness bugs through numerical coincidence. |

## Error Magnitude Guide

Quick triage based on how wrong the values are:
- **>100x off** = wrong weights or missing dequantization
- **~2x off** = missing `sqrt(2)` residual scaling or `sqrt(hidden_size)` embedding scaling
- **Small systematic** = wrong activation function or padding asymmetry
- **All NaN** = `exp()` overflow — clamp inputs to [-88, 88]
- **All zeros in debug readback** = missing `COPY_SRC` buffer flag
- **~22% off on some images** = letterbox offset rounding (use Math.floor)
- **2-3% systematic offset** = coordinate space mismatch (pixel vs normalized) or half_pixel_centers
- **10x inflated on batch tests** = temporal smoother state not reset between inputs
- **0% tracking rate** = ROI tracking threshold too high (try 0.1)
- **Low recall (missed detections)** = manual bilinear interpolation — switch to textureSampleLevel
- **Output is a constant (e.g., always ~0.73 or ~1.0)** = wrong output head in nested TFLite model — check bias magnitudes
- **Plausible but wrong after removing redundant activation** = double-sigmoid masking — the redundancy was hiding a deeper bug
