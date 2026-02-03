---
name: books
description: Download free PDF/EPUB books from Ocean of PDF. Use when asked to download books, find ebooks, or get PDFs of books.
---

# Free Book Downloader (Ocean of PDF)

Download free PDF and EPUB books from oceanofpdf.com using Chrome automation.

## Prerequisites

- Chrome browser with chrome-control extension
- Popups must be allowed for oceanofpdf.com

## Step 1: Search for the Book

```bash
~/.claude/skills/chrome-control/scripts/chrome open "https://oceanofpdf.com"
# Wait for page load, then:
~/.claude/skills/chrome-control/scripts/chrome read <tab_id> forms
~/.claude/skills/chrome-control/scripts/chrome type <tab_id> ref_XX "Book Title Author Name"
~/.claude/skills/chrome-control/scripts/chrome click <tab_id> ref_YY  # Search button
```

## Step 2: Navigate to Book Page

```bash
~/.claude/skills/chrome-control/scripts/chrome screenshot <tab_id>
~/.claude/skills/chrome-control/scripts/chrome read <tab_id> links
~/.claude/skills/chrome-control/scripts/chrome click <tab_id> ref_XX  # Book title link
```

## Step 3: Download (Key Step!)

**IMPORTANT**: Download buttons are hidden form inputs - must submit via JavaScript.

```bash
# Find the PDF filename
~/.claude/skills/chrome-control/scripts/chrome js <tab_id> "document.querySelector('input[value*=\".pdf\"]')?.value"

# Submit the form to trigger download
~/.claude/skills/chrome-control/scripts/chrome js <tab_id> "document.querySelector('input[value*=\".pdf\"]').closest('form').submit(); 'submitted'"
```

For EPUB:
```bash
~/.claude/skills/chrome-control/scripts/chrome js <tab_id> "document.querySelector('input[value*=\".epub\"]').closest('form').submit(); 'submitted'"
```

## Step 4: Find Downloaded File

```bash
ls -la ~/Downloads/assistant/
# Files named like: _OceanofPDF.com_Book_Title_-_Author_Name.pdf
```

## Troubleshooting

1. **Popup blocked**: Enable popups for oceanofpdf.com in Chrome settings
2. **Form not found**: Scroll down - download section may be below fold
3. **Download not starting**: Check `chrome tabs` for "Fetching Resource" tab
