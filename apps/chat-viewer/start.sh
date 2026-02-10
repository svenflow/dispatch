#!/bin/bash
# Start chat-viewer servers

# Set PATH for homebrew node
export PATH="/opt/homebrew/bin:$PATH"

cd /Users/jsmith/code/chat-viewer

# Kill any existing processes on our ports
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

sleep 1

# Start FastAPI backend
cd /Users/jsmith/code/chat-viewer
/Users/jsmith/.local/bin/uv run server.py &
BACKEND_PID=$!

# Start Vite frontend
cd /Users/jsmith/code/chat-viewer/frontend
/opt/homebrew/bin/npm run dev &
FRONTEND_PID=$!

echo "Started backend (PID $BACKEND_PID) and frontend (PID $FRONTEND_PID)"

# Wait for both
wait
