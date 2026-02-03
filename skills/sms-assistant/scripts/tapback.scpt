-- Tapback reaction script
-- Usage: osascript tapback.scpt "thumbsup"
-- Reacts to the most recent incoming message in the currently visible chat
-- Reactions: heart(1), thumbsup(2), thumbsdown(3), haha(4), exclamation(5), question(6)

on run argv
    set reactionType to item 1 of argv

    -- Map reaction names to numbers
    if reactionType is "heart" then
        set reactionNum to 1
    else if reactionType is "thumbsup" then
        set reactionNum to 2
    else if reactionType is "thumbsdown" then
        set reactionNum to 3
    else if reactionType is "haha" then
        set reactionNum to 4
    else if reactionType is "exclamation" then
        set reactionNum to 5
    else if reactionType is "question" then
        set reactionNum to 6
    else
        set reactionNum to reactionType as integer
    end if

    tell application "Messages"
        activate
    end tell

    delay 0.5

    -- Use keyboard shortcut for tapback on most recent message
    -- Cmd+T opens tapback menu, then number selects reaction
    tell application "System Events"
        tell process "Messages"
            keystroke "t" using command down
            delay 0.3
            keystroke (reactionNum as string)
        end tell
    end tell

    return "TAPBACK|" & reactionType
end run
