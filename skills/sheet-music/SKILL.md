---
name: sheet-music
description: Find and download free piano sheet music. Use when asked about sheet music, piano music, or music scores.
---

# Free Sheet Music Finder

A guide for finding, downloading, and enhancing free piano sheet music.

---

## Part 1: Free Sheet Music Sites (Ranked)

### Tier 1: Best Quality

| Site | Best For | Difficulty Levels | Quality |
|------|----------|-------------------|---------|
| **MuseScore.com** | Largest catalog (2.6M+), pop music | Yes (beginner→advanced) | Variable (check ratings) |
| **IMSLP.org** | Classical/public domain (600K+) | Some lists | High (scanned originals) |
| **8notes.com** | Curated rock/pop classics | 7 levels | Highest (hand-selected) |

### Tier 2: Good Free Options

| Site | Best For | Notes |
|------|----------|-------|
| **PopPiano.org** | Contemporary pop (100K+) | Direct PDF downloads |
| **Free-Scores.com** | Difficulty filtering | 3 free downloads/day |
| **Mutopia Project** | Classical (LilyPond typeset) | Editable source files |
| **EveryonePiano.com** | Pop songs | Low-res previews (needs AI upscaling) |

### Key Insights from Reddit

- MuseScore: Filter by high ratings to find quality arrangements
- IMSLP: Best for classical, skip for modern pop
- Free sites for pop = gray area legally, but low risk for personal use
- Most free sites have low-res previews - use AI upscaling (see Part 3)

---

## Part 2: Downloading Sheet Music Images

Many free sites only offer preview images. Here's how to download and combine them:

### Download Multiple Pages

```bash
mkdir -p /tmp/sheet_music
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o "/tmp/sheet_music/page_$i.jpg" "https://example.com/image-$i.jpg"
done
```

### Combine Images into PDF

```bash
cd /tmp/sheet_music && uv run --with pillow python -c "
from PIL import Image
import os

images = []
for f in sorted([x for x in os.listdir('.') if x.endswith('.jpg')]):
    img = Image.open(f).convert('RGB')
    images.append(img)

images[0].save('output.pdf', save_all=True, append_images=images[1:])
print('Created output.pdf')
"
```

### Common EveryonePiano Image URLs

```
https://www.everyonepiano.com/pianomusic/XXX/XXXXXXX/XXXXXXX-w-s-{1-N}.jpg
```
Where `-w-s-` = stave notation, `-j-s-` = numbered notation

---

## Part 3: AI Upscaling for Low-Res Images

Many free sites provide tiny preview images (often 200x260 pixels). Use EDSR (Enhanced Deep Residual Networks) to upscale with AI.

### When to Use

- Images are blurry or pixelated
- Source images are small thumbnails (under 500px)
- Basic upscaling (LANCZOS) isn't enough

### One-Liner AI Upscale + PDF

```bash
cd /tmp/sheet_music && uv run --with super-image --with pillow python << 'EOF'
from super_image import EdsrModel, ImageLoader
from PIL import Image
import os

model = EdsrModel.from_pretrained('eugenesiow/edsr-base', scale=4)
os.makedirs('upscaled', exist_ok=True)

images = []
for f in sorted([x for x in os.listdir('.') if x.endswith('.jpg')]):
    pil_img = Image.open(f)
    preds = model(ImageLoader.load_image(pil_img))
    ImageLoader.save_image(preds, f'upscaled/{f}')
    img = Image.open(f'upscaled/{f}').convert('RGB')
    images.append(img)

images[0].save('enhanced.pdf', save_all=True, append_images=images[1:])
print('Done! Created enhanced.pdf')
EOF
```

### Results

- 200x260 → 800x1040 pixels (4x upscale)
- ~23KB → ~176KB per image (8x more detail)
- Uses deep learning to intelligently reconstruct detail

### Why EDSR Works Better

| Method | Result |
|--------|--------|
| LANCZOS/Bicubic | Blurry, just interpolates pixels |
| Adaptive Threshold | Loses detail, creates artifacts |
| Sharpening filters | Amplifies noise |
| **EDSR (AI)** | Learns to reconstruct realistic detail |

EDSR was trained on millions of image pairs - it knows how to reconstruct fine details like text, lines, and musical notation.

### Alternative Models

```python
# Better quality (slower):
model = EdsrModel.from_pretrained('eugenesiow/edsr', scale=4)

# 2x upscale only:
model = EdsrModel.from_pretrained('eugenesiow/edsr-base', scale=2)
```
