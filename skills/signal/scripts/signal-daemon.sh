#!/usr/bin/env bash
# Signal CLI daemon management
# Usage: signal-daemon.sh start|stop|status

set -e

SIGNAL_CLI="/opt/homebrew/bin/signal-cli"
SOCKET_PATH="/tmp/signal-cli.sock"
PID_FILE="/tmp/signal-cli-daemon.pid"
# Set via config.local.yaml signal.account
ACCOUNT="${SIGNAL_ACCOUNT:-}"

start() {
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Signal daemon already running (PID: $(cat "$PID_FILE"))"
        return 0
    fi

    # Clean up stale socket
    rm -f "$SOCKET_PATH"

    echo "Starting signal-cli daemon..."
    $SIGNAL_CLI -a "$ACCOUNT" daemon --socket "$SOCKET_PATH" &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"

    # Wait for socket to be ready
    for i in {1..30}; do
        if [[ -S "$SOCKET_PATH" ]]; then
            echo "Signal daemon started (PID: $DAEMON_PID)"
            return 0
        fi
        sleep 0.1
    done

    echo "ERROR: Daemon started but socket not ready"
    return 1
}

stop() {
    if [[ -f "$PID_FILE" ]]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping signal daemon (PID: $PID)..."
            kill "$PID"
            rm -f "$PID_FILE" "$SOCKET_PATH"
            echo "Stopped."
        else
            echo "PID file exists but process not running. Cleaning up."
            rm -f "$PID_FILE" "$SOCKET_PATH"
        fi
    else
        echo "No PID file found. Killing any signal-cli daemons..."
        pkill -f "signal-cli.*daemon" 2>/dev/null || true
        rm -f "$SOCKET_PATH"
    fi
}

status() {
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Signal daemon running (PID: $(cat "$PID_FILE"))"
        [[ -S "$SOCKET_PATH" ]] && echo "Socket: $SOCKET_PATH (ready)" || echo "Socket: NOT READY"
    else
        echo "Signal daemon not running"
    fi
}

case "${1:-}" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    restart) stop; sleep 1; start ;;
    *) echo "Usage: $0 {start|stop|status|restart}"; exit 1 ;;
esac
