# Voice Notes

Nikhil's voice-recorded notes captured via Sven app.

---

## Note 1

You're going to call inject prompt on the admin.

---

To show her where that follows.

---

## Bug Report

Also, it just keep randomly shuts on me after like [cut off]

---

After like 10 seconds and that like cuts me off. Like, I don't know what's going on, something's super buggy. Please review deeply.


## Bug: 10 second cutoff & double-send

**Problem 1: Recording cuts off after ~10 seconds**
- RecordingSheet has its own silence timer (1.5 seconds in silenceThreshold at line 25)
- AudioRecorder ALSO has a silence timer (2.0 seconds at line 63)
- Both can trigger auto-stop, may be fighting each other

**Problem 2: Double-send when manual send + auto-send both fire**
- RecordingSheet triggers `triggerAutoSend()` after silence countdown hits 0
- User taps send button calling `sendNow()`
- BOTH paths call `onSend(transcript)` 
- The `hasSent` flag in RecordingSheet (line 20) should prevent this but...
- The issue: `onChange(of: recorder.pendingTranscriptToSend)` in ContentView.swift (lines 123-133) is a SECOND path that also sends!
  - AudioRecorder sets `pendingTranscriptToSend` when it auto-stops
  - ContentView watches this and calls `sendMessage()` again

**Root cause of double-send:**
Two independent auto-send mechanisms:
1. RecordingSheet's silence countdown → completeSend() → onSend()
2. AudioRecorder's silence detection → sets pendingTranscriptToSend → ContentView sends again

**And I think also like when it's sending, we don't like** [note cut off]

---


## Personal Note

And I totally focused on world. No time for a personal life.

---

