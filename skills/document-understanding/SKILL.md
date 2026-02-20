---
name: document-understanding
description: Extract text from images and PDFs using local OCR. Trigger words - OCR, scan, extract text, read document, parse PDF, W-2, tax form, receipt, invoice.
---

# Document Understanding

Local OCR and document parsing using Apple's Vision Framework. 100% on-device, no cloud APIs.

## Quick Start

```bash
# OCR an image (returns text with bounding boxes + confidence)
uvx ocrmac path/to/image.png

# OCR with structured JSON output
~/.claude/skills/document-understanding/scripts/ocr path/to/file.png

# OCR a PDF (converts pages to images first)
~/.claude/skills/document-understanding/scripts/ocr path/to/file.pdf
```

## CLI: `ocr`

The `ocr` script wraps ocrmac with:
- PDF support (auto-converts pages to images)
- Structured JSON output with confidence scores
- Multi-page document handling
- Optimized for Apple Silicon

### Usage

```bash
# Single image
~/.claude/skills/document-understanding/scripts/ocr receipt.png

# PDF document
~/.claude/skills/document-understanding/scripts/ocr tax-form.pdf

# Specific PDF page
~/.claude/skills/document-understanding/scripts/ocr document.pdf --page 1
```

### Output Format

```json
{
  "file": "document.png",
  "pages": [
    {
      "page": 1,
      "text": "full extracted text...",
      "blocks": [
        {
          "text": "Box 1 Wages",
          "confidence": 0.98,
          "bbox": [x, y, width, height]
        }
      ]
    }
  ]
}
```

## Use Cases

- **Tax forms**: W-2, 1099, tax returns
- **Receipts**: expense tracking, reimbursement
- **Invoices**: bill parsing, payment processing
- **Scanned documents**: contracts, letters
- **Screenshots**: extracting text from images

## Dependencies

- `ocrmac` - Python wrapper for Apple Vision Framework
- `sips` - macOS built-in image conversion (for PDFs)
- Runs 100% locally on Apple Silicon

## Notes

- Works best with clear, high-resolution images
- For handwritten text, accuracy may vary
- PDF conversion uses macOS Preview/sips (no external dependencies)
