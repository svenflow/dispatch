# Sven App Recording UI Redesign Plan

**Status:** Ready for implementation
**Rating:** 8.2/10 (with improvements below targeting 9+)
**Last Updated:** 2026-02-10

---

## Overview

Redesign the voice recording UI to feel lightweight, beautiful, and effortless while maintaining chat context visibility.

---

## Design Specification

### 1. Layout & Entry

**Compact Recording Sheet**
- Tap mic → Sheet slides up covering **35-40% of screen** (not 70%)
- Glass morphism background so chat remains visible behind
- Auto-expands to **55%** only if transcript exceeds 3-4 lines
- **Swipe-down-to-dismiss** for quick cancel (matches iOS sheet conventions)

### 2. Visual Elements

**Mic Icon with Audio-Reactive Waveform**
- **56-64pt mic icon** (responsive to device size, not 72pt)
- Ring around mic pulses based on **actual microphone input volume**
- Breathing animation (1.2s cycle) as baseline when quiet
- Recording duration timer below mic

**Real-Time Transcription (Sheet Only)**
- Words appear with spring animation as spoken
- Current word highlighted at 1.2x scale
- Scrolls within sheet for long recordings
- **Max recording length:** 2 minutes (with warning at 1:45)

**Inline Chat Placeholder (NOT full transcription)**
- Pulsing coral/red dot indicator shows "recording in progress"
- Text only populates when recording ends
- Reduces visual noise vs showing same text in two places

### 3. Auto-Send Behavior

**Silence Detection & Auto-Send**
- **0.8s silence:** Mic icon begins dimming, ripple slows
- **1.5s silence:** Auto-send countdown begins
- Visual: Ring around mic depletes as countdown progresses
- Tap to send early OR keep talking to reset timer

**Edit Before Send Window**
- After countdown completes, **2-3 second "undo" window** before actually sending
- Minimal toast: "Sending... (tap to cancel)"
- Catches transcription mistakes

### 4. Manual Controls

**Buttons (Secondary to Auto-Send)**
- Cancel (red) and Send (blue) at bottom of sheet
- Smaller/lower contrast than auto-send indicator
- For users who prefer explicit control

**Cancel Confirmation**
- For recordings **over 30 seconds**, swipe-to-dismiss triggers confirmation dialog
- Prevents accidental loss of substantial content

### 5. Haptic Feedback

| Action | Haptic |
|--------|--------|
| Recording start | Medium impact |
| Each word recognized | Soft tap (optional, user-configurable) |
| Recording end/send | Success |
| Cancel | Rigid |

### 6. Transitions & Animations

**Recording Start**
- Sheet slides up with spring curve (0.3s)
- Mic icon fades in with scale animation
- Breathing animation begins

**During Recording**
- Words appear with spring animation
- Waveform ring responds to audio level
- Silence: mic dims, ripple slows

**Recording End**
- Sheet slides down
- Placeholder in chat transforms to actual message
- Shows "Sending..." state
- Success haptic

### 7. Error Handling

**Transcription Failure**
- Graceful degradation state
- "Couldn't transcribe, tap to retry"
- Audio preserved locally for retry

**Network Issues**
- Queue message for retry when connection restored
- Show offline indicator

### 8. Accessibility

**VoiceOver**
- Announce waveform state ("Recording active", "Silence detected")
- Mic button label: "Record voice message"
- Announce countdown: "Sending in 3, 2, 1..."

**Reduce Motion**
- Replace spring animations with fade
- Static waveform indicator instead of animated ring
- Respect `@Environment(\.accessibilityReduceMotion)`

### 9. Long Recording Handling

- **Max length:** 2 minutes
- Warning indicator at 1:45 (ring turns yellow)
- Auto-stop at 2:00 with haptic
- Transcription scrolls within sheet (auto-scroll to latest, manual scroll to review)

---

## Implementation Checklist

### Phase 1: Core Recording Sheet
- [ ] Create `RecordingSheet` view with 35-40% height
- [ ] Implement glass morphism background
- [ ] Add swipe-to-dismiss gesture
- [ ] Responsive mic icon size (56-64pt based on device)

### Phase 2: Audio Visualization
- [ ] Build waveform ring component
- [ ] Connect to actual microphone audio levels
- [ ] Implement breathing animation baseline
- [ ] Add silence detection visual feedback (dimming)

### Phase 3: Real-Time Transcription
- [ ] Word-by-word spring animation
- [ ] Current word highlighting (1.2x scale)
- [ ] Scrolling for long transcripts
- [ ] Single location display (sheet only)

### Phase 4: Auto-Send System
- [ ] Implement 1.5s silence detection timer
- [ ] Build depleting ring countdown indicator
- [ ] Add 2-3s undo window with toast
- [ ] Tap to send early / keep talking to reset

### Phase 5: Chat Integration
- [ ] Create pulsing placeholder indicator
- [ ] Transform placeholder to message on send
- [ ] Handle "Sending..." state transition

### Phase 6: Haptics
- [ ] Add all haptic feedback points
- [ ] Make word-recognition haptic optional (Settings)

### Phase 7: Error & Edge Cases
- [ ] Transcription failure state
- [ ] Cancel confirmation for 30s+ recordings
- [ ] 2-minute max length with warning
- [ ] Network error handling

### Phase 8: Accessibility
- [ ] VoiceOver announcements
- [ ] Reduce motion alternatives
- [ ] Button labels and hints

---

## Design Tokens

```swift
// Colors
let recordingPlaceholderColor = Color(red: 1.0, green: 0.4, blue: 0.4, opacity: 0.15)  // Soft coral
let silenceIndicatorColor = Color.gray.opacity(0.5)
let countdownRingColor = Color.blue

// Sizes
let micIconSize: CGFloat = UIScreen.main.bounds.width < 375 ? 56 : 64
let sheetHeightCompact: CGFloat = 0.38  // 38% of screen
let sheetHeightExpanded: CGFloat = 0.55  // 55% of screen

// Timing
let breathingAnimationDuration: TimeInterval = 1.2
let silenceFeedbackDelay: TimeInterval = 0.8
let autoSendSilenceThreshold: TimeInterval = 1.5
let undoWindowDuration: TimeInterval = 2.5
let maxRecordingDuration: TimeInterval = 120  // 2 minutes
let recordingWarningTime: TimeInterval = 105  // 1:45

// Animations
let sheetTransition = Animation.spring(response: 0.3, dampingFraction: 0.8)
let wordEntrance = Animation.spring(response: 0.25, dampingFraction: 0.7)
let reduceMotionFallback = Animation.easeInOut(duration: 0.2)
```

---

## UX Review History

| Version | Rating | Key Feedback |
|---------|--------|--------------|
| v1 (initial) | 7.5/10 | Sheet too large (70%), redundant transcription display |
| v2 (current) | 8.2/10 | Good foundation, needs error handling, accessibility, edge cases |

---

## References

- [Textream](https://github.com/f/textream) - Word-level highlighting, real-time text display
- Apple HIG - Motion, Sheets, Accessibility
- WhatsApp/Telegram - Voice message recording patterns
- Whisper Notes - Waveform visualization
