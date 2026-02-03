#!/usr/bin/env python3
"""Claude Assistant menu bar app."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import rumps

# Paths
ASSISTANT_DIR = Path(__file__).parent.parent
STATE_DIR = ASSISTANT_DIR / "state"
PID_FILE = STATE_DIR / "daemon.pid"
TRANSCRIPTS_DIR = Path.home() / "transcripts"
TMUX = "/opt/homebrew/bin/tmux"


class ClaudeAssistantApp(rumps.App):
    def __init__(self):
        super().__init__(self._get_title(), quit_button=None)
        self.menu = self._build_menu()

        # Update status every 10 seconds
        self.timer = rumps.Timer(self._refresh, 10)
        self.timer.start()

    def _get_title(self) -> str:
        """Get menu bar title based on daemon status."""
        if self._is_daemon_running():
            return "🟢"  # Running
        return "🔴"  # Stopped

    def _is_daemon_running(self) -> bool:
        """Check if daemon is running."""
        if not PID_FILE.exists():
            return False
        try:
            pid = int(PID_FILE.read_text().strip())
            os.kill(pid, 0)
            return True
        except (ValueError, ProcessLookupError, PermissionError):
            return False

    def _get_active_tmux_sessions(self) -> set:
        """Get set of active tmux session names."""
        result = subprocess.run([TMUX, "ls"], capture_output=True, text=True)
        if result.returncode != 0:
            return set()
        sessions = set()
        for line in result.stdout.strip().split("\n"):
            if line:
                name = line.split(":")[0]
                if name != "monitor":
                    sessions.add(name)
        return sessions

    def _get_contacts(self) -> list[tuple]:
        """Get list of contacts from transcript folders with active status.

        Returns list of (folder_name, is_active) tuples, sorted by name.
        """
        active_sessions = self._get_active_tmux_sessions()
        contacts = []

        if TRANSCRIPTS_DIR.exists():
            for folder in sorted(TRANSCRIPTS_DIR.iterdir()):
                if folder.is_dir() and not folder.name.startswith('.'):
                    # Check if there's an active tmux session for this contact
                    is_active = folder.name in active_sessions
                    contacts.append((folder.name, is_active))

        return contacts

    def _build_menu(self) -> list:
        """Build the menu structure."""
        menu = []

        # Status
        if self._is_daemon_running():
            menu.append(rumps.MenuItem("Status: Running", callback=None))
        else:
            menu.append(rumps.MenuItem("Status: Stopped", callback=None))

        menu.append(None)  # Separator

        # Daemon controls
        menu.append(rumps.MenuItem("Start Daemon", callback=self._start_daemon))
        menu.append(rumps.MenuItem("Stop Daemon", callback=self._stop_daemon))
        menu.append(rumps.MenuItem("Restart Daemon", callback=self._restart_daemon))

        menu.append(None)  # Separator

        # Contacts submenu (from transcript folders)
        contacts_menu = rumps.MenuItem("Contacts")
        contacts = self._get_contacts()
        if contacts:
            for name, is_active in contacts:
                indicator = "🟢" if is_active else "⚫"
                item = rumps.MenuItem(f"{indicator} {name}", callback=self._attach_session if is_active else None)
                contacts_menu.add(item)
        else:
            contacts_menu.add(rumps.MenuItem("(no contacts)", callback=None))
        menu.append(contacts_menu)

        # Skills browser
        menu.append(rumps.MenuItem("Browse Skills", callback=self._browse_skills))

        # Chat viewer
        menu.append(rumps.MenuItem("Chat Viewer", callback=self._open_chat_viewer))

        menu.append(None)  # Separator

        # Logs
        menu.append(rumps.MenuItem("View Logs", callback=self._view_logs))

        menu.append(None)  # Separator

        # Quit
        menu.append(rumps.MenuItem("Quit", callback=rumps.quit_application))

        return menu

    def _browse_skills(self, _):
        """Launch the Skills Browser app."""
        skills_browser = Path.home() / "code" / "skills-browser"
        subprocess.Popen(
            ["uv", "run", "python", "app.py"],
            cwd=skills_browser,
            start_new_session=True
        )

    def _open_chat_viewer(self, _):
        """Open Chat Viewer in browser."""
        subprocess.run(["open", "http://localhost:5173"])

    def _refresh(self, _=None):
        """Refresh the menu and title."""
        self.title = self._get_title()
        self.menu.clear()
        for item in self._build_menu():
            if item is None:
                self.menu.add(None)
            else:
                self.menu.add(item)

    def _start_daemon(self, _):
        """Start the daemon."""
        subprocess.run(["claude-assistant", "start"])
        self._refresh()
        rumps.notification("Claude Assistant", "Daemon started", "")

    def _stop_daemon(self, _):
        """Stop the daemon."""
        subprocess.run(["claude-assistant", "stop"])
        self._refresh()
        rumps.notification("Claude Assistant", "Daemon stopped", "")

    def _restart_daemon(self, _):
        """Restart the daemon."""
        subprocess.run(["claude-assistant", "restart"])
        self._refresh()
        rumps.notification("Claude Assistant", "Daemon restarted", "")

    def _attach_session(self, sender):
        """Open Terminal and attach to session."""
        # Remove the indicator prefix (🟢 or ⚫) from the title
        session_name = sender.title.split(" ", 1)[1] if " " in sender.title else sender.title
        # Open Terminal and attach to the tmux session
        script = f'''
        tell application "Terminal"
            activate
            do script "{TMUX} attach -t {session_name}"
        end tell
        '''
        subprocess.run(["osascript", "-e", script])

    def _view_logs(self, _):
        """Open logs in Console.app."""
        log_file = ASSISTANT_DIR / "logs" / "manager.log"
        subprocess.run(["open", "-a", "Console", str(log_file)])


if __name__ == "__main__":
    ClaudeAssistantApp().run()
