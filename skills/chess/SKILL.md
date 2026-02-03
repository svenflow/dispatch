---
name: chess
description: Play chess on chess.com via browser automation. Use when asked to play chess, check chess games, make moves, or challenge opponents. Account is nacloood.
---

# Chess Skill

Play chess on chess.com via the chrome-control CLI. Account: nacloood.

You are an elite chess player - among the best in the world. Trust your analysis and play confidently.

## Quick Reference

```bash
CHROME=~/.claude/skills/chrome-control/scripts/chrome
```

## CRITICAL: Only Use JavaScript API for Moves

**DO NOT use coordinate clicks, cliclick, or any other click-based approach.**
**DO NOT use `document.querySelector('[data-square="e2"]').click()`**

The ONLY reliable way to make moves is via the `game.move()` JavaScript API:

```bash
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.move('Nc6')"
```

This is the single source of truth for making moves. Everything else is deprecated.

## Key Facts

1. **No global `game` variable** - Access via `document.querySelector('wc-chess-board').game`
2. **Check whose turn** - `getTurn()` returns 1 (white) or 2 (black)
3. **Check your color** - `getPlayingAs()` returns 1 (white) or 2 (black)
4. **It's your turn when** - `getTurn() === getPlayingAs()`
5. **game.move() does NOT submit** - It only animates locally. You MUST click pieces to submit.

## CRITICAL: How to Actually Submit Moves

**The `game.move()` API only moves pieces locally - it does NOT submit to the server.**

To actually submit a move in daily games:
1. **Click the piece** to select it (dots show legal moves)
2. **Click the destination square**
3. **Click "Submit Move" button** (green checkmark that appears)

```bash
# 1. Get piece position
$CHROME js <tab_id> "const p = document.querySelector('.piece.square-47'); const r = p.getBoundingClientRect(); JSON.stringify({cx: r.left + r.width/2, cy: r.top + r.height/2})"

# 2. Click piece to select
$CHROME click-at <tab_id> <piece_x> <piece_y>

# 3. Click destination square
$CHROME click-at <tab_id> <dest_x> <dest_y>

# 4. Find and click Submit button
$CHROME read <tab_id> | grep -i "submit"
$CHROME click <tab_id> ref_XX  # Click "Submit Move"
```

**Square notation:** Pieces have class `square-XY` where X=file (1-8 for a-h), Y=rank (1-8)

---

## JavaScript API (Primary Method)

**ALWAYS use the JavaScript API for moves - never use coordinate clicks.**

The chess.com board exposes a `game` object via the board element:

```bash
# IMPORTANT: Access game via the board element - there's no global 'game' variable
# Always use: document.querySelector('wc-chess-board').game

# Get current position (FEN)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getFEN()"
# Returns: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"

# Get move history (array of SAN moves)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getHistorySANs()"
# Returns: ["e4", "c5", "Nf3", "Nc6"]

# Get legal moves (array of SAN strings)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getLegalMoves().map(m => m.san)"
# Returns: ["Nc6", "Na6", "Qc7", "Nf6", "d6", "e6", ...]

# Get which color you're playing (1=white, 2=black)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getPlayingAs()"

# Get whose turn it is (1=white, 2=black)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getTurn()"

# Check if it's your turn
$CHROME js <tab_id> "var g = document.querySelector('wc-chess-board').game; g.getTurn() === g.getPlayingAs()"
# Returns: true if it's your turn

# Get last move played
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getLastMove()?.san"
```

## Making a Move (Click Method - REQUIRED for Daily Games)

**IMPORTANT: The JS API `game.move()` does NOT submit moves. You must use clicks.**

```bash
# 1. Find the piece you want to move (e.g., pawn on d7 = square-47)
$CHROME js <tab_id> "const p = document.querySelector('.piece.square-47'); const r = p.getBoundingClientRect(); JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2})"

# 2. Click on the piece to select it
$CHROME click-at <tab_id> <x> <y>

# 3. Click on destination square (calculate from board position)
$CHROME click-at <tab_id> <dest_x> <dest_y>

# 4. Click Submit Move button
$CHROME read <tab_id> | grep -i submit
$CHROME click <tab_id> ref_XX
```

**Board coordinate calculation:**
```bash
# Get board dimensions
$CHROME js <tab_id> "const b = document.querySelector('wc-chess-board').getBoundingClientRect(); JSON.stringify({left: b.left, top: b.top, sq: b.width/8})"

# For non-flipped (White): file a=0, h=7; rank 8=0, 1=7
# For flipped (Black): file h=0, a=7; rank 1=0, 8=7
# Square center: x = left + (fileIndex + 0.5) * squareSize
```

## Complete Move Workflow

```bash
CHROME=~/.claude/skills/chrome-control/scripts/chrome
TAB=<tab_id>

# 1. Get full game state including whose turn
$CHROME js $TAB "var g = document.querySelector('wc-chess-board').game; JSON.stringify({
    turn: g.getTurn(),
    playingAs: g.getPlayingAs(),
    history: g.getHistorySANs()
})"
# turn=1 means white to move, turn=2 means black to move
# If turn !== playingAs, it's NOT your turn - skip this game

# 2. If it IS your turn, get legal moves
$CHROME js $TAB "document.querySelector('wc-chess-board').game.getLegalMoves().map(m => m.san)"

# 3. Analyze position and make the move
$CHROME js $TAB "document.querySelector('wc-chess-board').game.move('Nf6')"

# 4. Verify turn changed (confirms move was submitted)
$CHROME js $TAB "document.querySelector('wc-chess-board').game.getTurn()"
# Should be different from before - now opponent's turn
```

## Check Pending Games

```bash
# Go to home page and see daily games
$CHROME nav <tab_id> "chess.com/home"
$CHROME screenshot <tab_id>

# Games show as "Daily Games (N)" with opponent names
# Click a game link to open it
$CHROME read <tab_id> | grep -i "daily\|14 days"
$CHROME click <tab_id> <game_ref>
```

## Challenge Someone (Always 14 Days)

```bash
# 1. Navigate to challenge page
$CHROME nav <tab_id> "chess.com/play/online/new?opponent=USERNAME"

# 2. Wait for page load, then change time control
sleep 2
$CHROME read <tab_id> | grep -i "rapid\|min"  # Find time dropdown
$CHROME click <tab_id> ref_XX  # Click time control button

# 3. Expand time options
$CHROME read <tab_id> | grep -i "more time"
$CHROME click <tab_id> ref_XX  # Click "More Time Controls"

# 4. Select 14 days
$CHROME read <tab_id> | grep "14 days"
$CHROME click <tab_id> ref_XX  # Click "14 days"

# 5. Send challenge
$CHROME read <tab_id> | grep -i "send"
$CHROME click <tab_id> ref_XX  # Click "Send Challenge"

# 6. Verify with screenshot
sleep 2
$CHROME screenshot <tab_id>
```

## Workflow: Playing All Pending Games

```bash
CHROME=~/.claude/skills/chrome-control/scripts/chrome

# 1. Go to home
$CHROME nav <tab_id> "chess.com/home"
sleep 3

# 2. Screenshot to see pending games - shows "Daily Games (N)"
$CHROME screenshot <tab_id>

# 3. Click first game (look for opponent names like "naboool  13 days")
$CHROME read <tab_id> links | grep -i "days"
$CHROME click <tab_id> <game_ref>
sleep 2

# 4. Check if it's YOUR turn before doing anything
$CHROME js <tab_id> "var g = document.querySelector('wc-chess-board').game; JSON.stringify({turn: g.getTurn(), playingAs: g.getPlayingAs(), history: g.getHistorySANs()})"
# If turn !== playingAs, skip to next game

# 5. If it IS your turn, analyze and play
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.move('YOUR_MOVE')"

# 6. Verify move submitted (turn should change)
$CHROME js <tab_id> "document.querySelector('wc-chess-board').game.getTurn()"

# 7. Use "Next Game" button or go back to home
$CHROME read <tab_id> | grep -i "next game"
$CHROME click <tab_id> ref_XX  # Click "Next Game"
# OR: $CHROME nav <tab_id> "chess.com/home"
```

**Important:** The "Next Game" button cycles through your ongoing games. Check `getTurn() === getPlayingAs()` for each to see if it's actually your move.

## Board Orientation

- `getPlayingAs()` returns 1 for White, 2 for Black
- Board is automatically flipped based on your color
- SAN notation is the same regardless of board orientation

## Notes

- Always use 14-day time control for challenges
- I play as "nacloood" on chess.com
- Take screenshots before and after moves for verification
- **Never use coordinate clicks** - use the JavaScript API
- The `game.move()` function handles both animation and submission
