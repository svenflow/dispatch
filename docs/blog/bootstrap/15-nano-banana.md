# 15: Nano Banana (Image Generation)

## Goal

Give Claude the ability to generate and edit images using Google's Gemini image models. This enables:
- Generating images from text prompts
- Editing existing images (background removal, style transfer, enhancements)
- Sending generated images to contacts via iMessage or Signal

The skill is called "Nano Banana" and uses Nano Banana Pro (Gemini 3 Pro Image) by default.

## Prerequisites

- Steps 01-05 completed (daemon running, messaging working)
- A Google account with age verification completed
- The nano-banana skill symlinked to `~/.claude/skills/`

## Architecture

```
User asks for an image via iMessage
        ↓
Claude session receives request
        ↓
Calls ~/.claude/skills/nano-banana/scripts/nano-banana
        ↓
Script loads GEMINI_API_KEY from ~/.claude/secrets.env
        ↓
Calls Google Gemini API (gemini-3-pro-image-preview)
        ↓
Saves PNG to /tmp/
        ↓
Claude sends image via send-sms --image
```

## Step 1: Get a Gemini API Key

### 1a. Age Verification (if needed)

Google AI Studio requires age verification. If you get redirected to an "Available Regions" page when visiting AI Studio, your account needs verification:

1. Go to https://myaccount.google.com/age-verification
2. Choose a verification method (credit card is fastest — no charge)
3. Wait for verification to complete

> **Gotcha:** This is a known issue. Even US-based accounts get redirected if age isn't verified. The page briefly flashes "model not found" before redirecting to the regions doc. See [Google AI Forum thread](https://discuss.ai.google.dev/t/bug-unable-to-access-google-ai-studio-anymore-redirects-to-available-regions-page-despite-being-in-supported-region-and-over-18/89615).

### 1b. Create or Copy Your API Key

1. Go to https://aistudio.google.com/apikey
2. If you already have a key, click it to view the full key
3. If not, click "Create API key" and select a project
4. Copy the key (starts with `AIza...`)

### 1c. Save the Key

Create `~/.claude/secrets.env`:

```bash
echo 'GEMINI_API_KEY=your-key-here' > ~/.claude/secrets.env
```

This file is loaded by the nano-banana script via `python-dotenv`.

## Step 2: Symlink the Skill

If not already done during skills setup (step 06):

```bash
ln -sf ~/dispatch/skills/nano-banana ~/.claude/skills/nano-banana
```

Verify:
```bash
ls ~/.claude/skills/nano-banana/scripts/nano-banana
```

## Step 3: Test Image Generation

```bash
# Generate a test image
~/.claude/skills/nano-banana/scripts/nano-banana "a small yellow banana wearing sunglasses" -o /tmp/test-banana.png

# Verify it was created
ls -la /tmp/test-banana.png
open /tmp/test-banana.png
```

First run will install dependencies via uv (google-genai, pillow, python-dotenv). Subsequent runs are fast.

### Test with the faster model

```bash
~/.claude/skills/nano-banana/scripts/nano-banana "sunset over mountains" -o /tmp/sunset.png --model gemini-2.5-flash-image
```

### Test image editing

```bash
~/.claude/skills/nano-banana/scripts/nano-banana "make the sky purple" -i /tmp/test-banana.png -o /tmp/edited.png
```

## Step 4: Test Sending Images via iMessage

```bash
# Send a generated image to admin
~/.claude/skills/sms-assistant/scripts/send-sms "+ADMIN_PHONE" "Here's a test image!" --image /tmp/test-banana.png
```

## Models

| Model | Quality | Speed | Max Input Images |
|-------|---------|-------|------------------|
| `gemini-3-pro-image-preview` (default) | Best | 5-15s | 14 |
| `gemini-2.5-flash-image` | Good | 2-5s | 3 |

## Wiring Checklist

- [ ] Google account age verified
- [ ] API key obtained from AI Studio
- [ ] `~/.claude/secrets.env` created with `GEMINI_API_KEY`
- [ ] nano-banana skill symlinked to `~/.claude/skills/`
- [ ] Test generation works (`nano-banana "test prompt" -o /tmp/test.png`)
- [ ] Test image sending works (send via iMessage)

## Troubleshooting

### "GEMINI_API_KEY not found"
- Check `~/.claude/secrets.env` exists and has the key
- Make sure there are no extra spaces: `GEMINI_API_KEY=AIza...` (no quotes needed)

### AI Studio redirects to "Available Regions"
- Complete age verification at https://myaccount.google.com/age-verification
- This affects even US-based accounts that haven't verified

### "No image was generated in the response"
- The model may have refused the prompt (safety filters)
- Try rephrasing or using a different prompt
- Check stderr output for the model's text response

### First run is slow
- uv needs to download dependencies (google-genai, pillow, python-dotenv)
- Subsequent runs reuse the cached packages
