#!/usr/bin/env python3
"""CLI for managing the Claude Assistant daemon."""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket as sock_module
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Dict

# Paths
ASSISTANT_DIR = Path(__file__).parent.parent
STATE_DIR = ASSISTANT_DIR / "state"
LOGS_DIR = ASSISTANT_DIR / "logs"
SESSION_LOG_DIR = LOGS_DIR / "sessions"
PID_FILE = STATE_DIR / "daemon.pid"
LOG_FILE = LOGS_DIR / "manager.log"

# Commands
UV = str(Path.home() / ".local/bin/uv")

# IPC socket
IPC_SOCKET = Path("/tmp/claude-assistant.sock")


def get_pid() -> Optional[int]:
    """Get the daemon PID if running."""
    if not PID_FILE.exists():
        return None
    try:
        pid = int(PID_FILE.read_text().strip())
        # Check if process is actually running
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        # PID file exists but process is dead
        PID_FILE.unlink(missing_ok=True)
        return None


def is_running() -> bool:
    """Check if daemon is running."""
    return get_pid() is not None


def _ipc_command(cmd: dict, timeout: float = 30) -> dict:
    """Send a command to the daemon via Unix socket IPC."""
    if not IPC_SOCKET.exists():
        print("Error: Daemon not running (IPC socket not found)", file=sys.stderr)
        print("Start with: claude-assistant start", file=sys.stderr)
        sys.exit(1)

    try:
        s = sock_module.socket(sock_module.AF_UNIX, sock_module.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect(str(IPC_SOCKET))
        s.sendall((json.dumps(cmd) + "\n").encode())

        # Read response
        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
            if b"\n" in data:
                break
        s.close()

        return json.loads(data.decode().strip())
    except ConnectionRefusedError:
        print("Error: Daemon not responding", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error communicating with daemon: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_start(args):
    """Start the daemon."""
    if is_running():
        print(f"Daemon already running (PID {get_pid()})")
        return 1

    # Ensure directories exist
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    # Start the manager as a background process
    log_fh = open(LOG_FILE, "a")
    process = subprocess.Popen(
        [UV, "run", "python", "-m", "assistant.manager"],
        cwd=ASSISTANT_DIR,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        start_new_session=True,  # Detach from terminal
    )
    log_fh.close()  # Popen has duped the fd; close ours (bug #27 fix)

    # Write PID file
    PID_FILE.write_text(str(process.pid))
    print(f"Daemon started (PID {process.pid})")
    print(f"Logs: {LOG_FILE}")
    return 0


def cmd_stop(args):
    """Stop the daemon."""
    pid = get_pid()
    if not pid:
        print("Daemon not running")
        return 1

    print(f"Stopping daemon (PID {pid})...")

    # Send SIGTERM to the entire process group (uv wrapper + child python process)
    # start_new_session=True in cmd_start creates a new process group with pgid=pid
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        print("Process already dead")
        PID_FILE.unlink(missing_ok=True)
        return 0
    except PermissionError:
        # Fallback to killing just the PID
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            print("Process already dead")
            PID_FILE.unlink(missing_ok=True)
            return 0

    # Wait for it to die
    for _ in range(10):
        try:
            os.kill(pid, 0)
            time.sleep(0.5)
        except ProcessLookupError:
            break
    else:
        # Force kill the process group if still running
        print("Force killing...")
        try:
            os.killpg(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    PID_FILE.unlink(missing_ok=True)
    print("Daemon stopped")
    return 0


def cmd_restart(args):
    """Restart the daemon.

    Spawns a detached helper script that stops the old daemon and starts a new one.
    This is safe to call from within a session — the session's process will die
    during stop, but the detached helper survives and starts a fresh daemon.
    """
    # Write a self-deleting restart script
    restart_script = STATE_DIR / "restart.sh"
    restart_script.write_text(f"""#!/bin/bash
# Auto-generated restart script - self-deletes after running
sleep 0.5
"{ASSISTANT_DIR}/bin/claude-assistant" stop 2>/dev/null
sleep 1
"{ASSISTANT_DIR}/bin/claude-assistant" start
rm -f "{restart_script}"
""")
    restart_script.chmod(0o755)

    # Launch detached so it survives our death
    subprocess.Popen(
        [str(restart_script)],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    print("Restart initiated (detached)")
    return 0


def cmd_status(args):
    """Show daemon status."""
    pid = get_pid()
    if pid:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "etime="],
            capture_output=True, text=True
        )
        uptime = result.stdout.strip()
        print(f"Daemon running (PID {pid}, uptime {uptime})")

        # Get sessions via IPC
        resp = _ipc_command({"cmd": "status"})
        if resp.get("ok") and resp.get("sessions"):
            print(f"\nActive sessions ({len(resp['sessions'])}):")
            for s in resp["sessions"]:
                busy = " [BUSY]" if s.get("is_busy") else ""
                turns = f" {s.get('turn_count', 0)} turns" if s.get('turn_count') else ""
                print(f"  {s.get('session_name', 'unknown'):20s} {s.get('contact_name', ''):20s} {s.get('tier', ''):10s}{busy}{turns}")
        else:
            print("\nNo active sessions")
        return 0
    else:
        print("Daemon not running")
        return 1


def cmd_logs(args):
    """Tail the log file."""
    if not LOG_FILE.exists():
        print(f"Log file not found: {LOG_FILE}")
        return 1

    lines = args.lines if hasattr(args, 'lines') else 50
    follow = args.follow if hasattr(args, 'follow') else False

    cmd = ["tail"]
    if follow:
        cmd.append("-f")
    cmd.extend(["-n", str(lines), str(LOG_FILE)])

    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        pass
    return 0


def cmd_attach(args):
    """Tail a session's log file."""
    session = args.session

    if not session:
        # List available session logs
        if SESSION_LOG_DIR.exists():
            logs = sorted(SESSION_LOG_DIR.glob("*.log"))
            if logs:
                print("Available session logs:")
                for log_file in logs:
                    name = log_file.stem
                    size = log_file.stat().st_size // 1024
                    print(f"  claude-assistant attach {name}  ({size}KB)")
            else:
                print("No session logs found")
        else:
            print("No session logs found")
        return 0

    log_file = SESSION_LOG_DIR / f"{session}.log"
    if not log_file.exists():
        print(f"No log file found for session: {session}")
        print(f"  Expected: {log_file}")
        return 1

    print(f"Tailing {log_file} (Ctrl+C to stop)")
    try:
        subprocess.run(["tail", "-f", "-n", "100", str(log_file)])
    except KeyboardInterrupt:
        pass
    return 0


def cmd_monitor(args):
    """Show live output from all session logs."""
    if not SESSION_LOG_DIR.exists():
        print("No session logs found")
        return 1

    logs = sorted(SESSION_LOG_DIR.glob("*.log"))
    if not logs:
        print("No session logs found")
        return 1

    print(f"Monitoring {len(logs)} session logs (Ctrl+C to stop)")
    try:
        subprocess.run(["tail", "-f"] + [str(l) for l in logs])
    except KeyboardInterrupt:
        pass
    return 0


def _load_registry() -> Dict:
    """Load the session registry."""
    from assistant.common import SESSION_REGISTRY_FILE
    if SESSION_REGISTRY_FILE.exists():
        try:
            return json.loads(SESSION_REGISTRY_FILE.read_text())
        except Exception:
            return {}
    return {}


def _session_name_to_chat_id(session: str) -> Optional[str]:
    """Look up chat_id from registry by session name."""
    registry = _load_registry()
    for cid, data in registry.items():
        if data.get("session_name") == session:
            return cid
    return None


def cmd_kill_session(args):
    """Kill a specific session."""
    session = args.session
    chat_id = _session_name_to_chat_id(session)

    if not chat_id:
        print(f"Session not found in registry: {session}")
        return 1

    resp = _ipc_command({"cmd": "kill_session", "chat_id": chat_id})
    if resp.get("ok"):
        print(f"Killed session: {session}")
    else:
        print(f"Error: {resp.get('error', 'unknown')}")
    return 0 if resp.get("ok") else 1


def cmd_kill_sessions(args):
    """Kill all sessions."""
    resp = _ipc_command({"cmd": "kill_all_sessions"})
    print(resp.get("message", "Done"))
    return 0


def cmd_restart_session(args):
    """Restart a specific session."""
    session = args.session
    chat_id = _session_name_to_chat_id(session)

    if not chat_id:
        print(f"Session not found in registry: {session}")
        return 1

    resp = _ipc_command({"cmd": "restart_session", "chat_id": chat_id})
    if resp.get("ok"):
        print(f"Restarted session: {session}")
    else:
        print(f"Error: {resp.get('error', 'unknown')}")
    return 0 if resp.get("ok") else 1


def cmd_restart_sessions(args):
    """Restart all sessions."""
    # Get all sessions, restart each
    resp = _ipc_command({"cmd": "status"})
    if not resp.get("ok") or not resp.get("sessions"):
        print("No sessions to restart")
        return 0

    count = 0
    for s in resp["sessions"]:
        chat_id = s.get("chat_id")
        if chat_id:
            r = _ipc_command({"cmd": "restart_session", "chat_id": chat_id})
            name = s.get("session_name", chat_id)
            if r.get("ok"):
                print(f"Restarted: {name}")
                count += 1
            else:
                print(f"Failed to restart {name}: {r.get('error')}")

    print(f"\nRestarted {count} sessions")
    return 0


def _lookup_contact_tier(contact_name: str) -> Optional[str]:
    """Look up a contact's tier from Contacts.app groups."""
    tier_groups = {
        "admin": "Claude Admin",
        "wife": "Claude Wife",
        "family": "Claude Family",
        "favorite": "Claude Favorites",
    }

    for tier, group_name in tier_groups.items():
        script = f'''
        tell application "Contacts"
            try
                set theGroup to group "{group_name}"
                set thePeople to people of theGroup
                repeat with p in thePeople
                    if name of p is "{contact_name}" then
                        return "{tier}"
                    end if
                end repeat
            end try
        end tell
        return ""
        '''
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True
        )
        if result.stdout.strip() == tier:
            return tier

    return None


def _lookup_contact_phone(contact_name: str) -> Optional[str]:
    """Look up a contact's phone number from Contacts.app."""
    script = f'''
    tell application "Contacts"
        try
            set thePerson to first person whose name is "{contact_name}"
            set thePhones to phones of thePerson
            if (count of thePhones) > 0 then
                return value of first item of thePhones
            end if
        end try
    end tell
    return ""
    '''
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True
    )
    phone = result.stdout.strip()
    if phone:
        # Normalize: ensure it starts with +
        if not phone.startswith("+"):
            phone = phone.replace("-", "").replace(" ", "").replace("(", "").replace(")", "")
            if len(phone) == 10:
                phone = f"+1{phone}"
            elif len(phone) == 11 and phone.startswith("1"):
                phone = f"+{phone}"
        return phone
    return None


def _lookup_contact_by_phone(phone: str) -> Optional[Dict[str, str]]:
    """Lookup contact info by phone number from Contacts.app."""
    contacts_cli = Path.home() / "code/contacts-cli/contacts"
    if not contacts_cli.exists():
        return None

    result = subprocess.run(
        [str(contacts_cli), "lookup", phone],
        capture_output=True, text=True
    )
    output = result.stdout.strip()

    # Output format: "Name | +1234567890 | tier"
    if output and "|" in output:
        parts = [p.strip() for p in output.split("|")]
        if len(parts) >= 3:
            return {
                "name": parts[0],
                "phone": parts[1],
                "tier": parts[2]
            }
    return None


def cmd_inject_prompt(args):
    """Inject a prompt into a contact's Claude session."""
    from assistant.common import normalize_chat_id, is_group_chat_id

    chat_id = normalize_chat_id(args.chat_id)

    # Get prompt
    if args.file:
        try:
            prompt = Path(args.file).read_text()
        except Exception as e:
            print(f"Error reading file: {e}", file=sys.stderr)
            return 1
    else:
        prompt = args.prompt

    if not prompt:
        print("Error: No prompt provided", file=sys.stderr)
        return 1

    # Look up contact info
    from assistant.common import SESSION_REGISTRY_FILE
    from assistant.sdk_backend import SessionRegistry
    registry = SessionRegistry(SESSION_REGISTRY_FILE)
    session_data = registry.get(chat_id)

    from assistant.backends import BACKENDS
    source = "imessage"
    for backend_name, cfg in BACKENDS.items():
        if cfg.registry_prefix and chat_id.startswith(cfg.registry_prefix):
            source = backend_name
            break

    if session_data:
        contact_name = session_data.get("contact_name") or session_data.get("display_name", "Unknown")
        tier = session_data.get("tier", "favorite")
    else:
        # Look up from Contacts
        lookup_phone = chat_id.removeprefix(BACKENDS[source].registry_prefix) if BACKENDS[source].registry_prefix else chat_id
        contact_info = _lookup_contact_by_phone(lookup_phone)
        if contact_info:
            contact_name = contact_info["name"]
            tier = contact_info["tier"]
        else:
            print(f"Error: Contact not found for {chat_id}", file=sys.stderr)
            return 1

    resp = _ipc_command({
        "cmd": "inject",
        "chat_id": chat_id,
        "prompt": prompt,
        "sms": args.sms,
        "admin": args.admin,
        "bg": args.bg,
        "contact_name": contact_name,
        "tier": tier,
        "source": source,
        "reply_to": getattr(args, 'reply_to', None),
    })

    if resp.get("ok"):
        print(resp.get("message", "Injected"))
    else:
        print(f"Error: {resp.get('error', 'unknown')}", file=sys.stderr)
    return 0 if resp.get("ok") else 1


def cmd_install(args):
    """Install LaunchAgent for auto-start on boot."""
    plist_src = ASSISTANT_DIR / "launchd" / "com.dispatch.claude-assistant.plist"
    plist_dst = Path.home() / "Library/LaunchAgents/com.dispatch.claude-assistant.plist"

    if not plist_src.exists():
        print(f"LaunchAgent plist not found: {plist_src}")
        return 1

    # Create LaunchAgents directory if needed
    plist_dst.parent.mkdir(parents=True, exist_ok=True)

    # Copy plist
    plist_dst.write_text(plist_src.read_text())
    print(f"Installed: {plist_dst}")

    # Load the agent
    subprocess.run(["launchctl", "load", str(plist_dst)])
    print("LaunchAgent loaded - daemon will start on login")
    return 0


def cmd_uninstall(args):
    """Uninstall LaunchAgent."""
    plist_dst = Path.home() / "Library/LaunchAgents/com.dispatch.claude-assistant.plist"

    if not plist_dst.exists():
        print("LaunchAgent not installed")
        return 1

    # Unload the agent
    subprocess.run(["launchctl", "unload", str(plist_dst)], capture_output=True)

    # Remove plist
    plist_dst.unlink()
    print("LaunchAgent uninstalled")
    return 0


# Menu bar app commands
MENUBAR_PLIST_SRC = ASSISTANT_DIR / "launchd" / "com.dispatch.claude-menubar.plist"
MENUBAR_PLIST_DST = Path.home() / "Library/LaunchAgents/com.dispatch.claude-menubar.plist"


def cmd_menubar(args):
    """Start the menu bar app (foreground)."""
    menubar_script = ASSISTANT_DIR / "bin" / "claude-menubar"
    if not menubar_script.exists():
        print(f"Menu bar app not found: {menubar_script}")
        return 1
    os.execvp(str(menubar_script), [str(menubar_script)])


def cmd_menubar_install(args):
    """Install menu bar LaunchAgent for auto-start."""
    if not MENUBAR_PLIST_SRC.exists():
        print(f"Menu bar plist not found: {MENUBAR_PLIST_SRC}")
        return 1

    # Create LaunchAgents directory if needed
    MENUBAR_PLIST_DST.parent.mkdir(parents=True, exist_ok=True)

    # Copy plist
    MENUBAR_PLIST_DST.write_text(MENUBAR_PLIST_SRC.read_text())
    print(f"Installed: {MENUBAR_PLIST_DST}")

    # Load the agent
    subprocess.run(["launchctl", "load", str(MENUBAR_PLIST_DST)])
    print("Menu bar app will start on login and is now running")
    return 0


def cmd_menubar_uninstall(args):
    """Uninstall menu bar LaunchAgent."""
    if not MENUBAR_PLIST_DST.exists():
        print("Menu bar LaunchAgent not installed")
        return 1

    # Unload the agent
    subprocess.run(["launchctl", "unload", str(MENUBAR_PLIST_DST)], capture_output=True)

    # Remove plist
    MENUBAR_PLIST_DST.unlink()
    print("Menu bar LaunchAgent uninstalled")
    return 0


def main():
    parser = argparse.ArgumentParser(
        prog="claude-assistant",
        description="Manage the Claude Assistant daemon"
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # start
    subparsers.add_parser("start", help="Start the daemon")

    # stop
    subparsers.add_parser("stop", help="Stop the daemon")

    # restart
    subparsers.add_parser("restart", help="Restart the daemon")

    # status
    subparsers.add_parser("status", help="Show daemon status")

    # logs
    logs_parser = subparsers.add_parser("logs", help="Tail the log file")
    logs_parser.add_argument("-n", "--lines", type=int, default=50, help="Number of lines")
    logs_parser.add_argument("-f", "--follow", action="store_true", help="Follow log output (tail -f)")

    # attach
    attach_parser = subparsers.add_parser("attach", help="Tail a session log file")
    attach_parser.add_argument("session", nargs="?", help="Session name")

    # monitor
    subparsers.add_parser("monitor", help="Show live output from all session logs")

    # kill-session
    kill_session_parser = subparsers.add_parser("kill-session", help="Kill a specific session")
    kill_session_parser.add_argument("session", help="Session name")

    # kill-sessions
    subparsers.add_parser("kill-sessions", help="Kill all sessions")

    # restart-session
    restart_session_parser = subparsers.add_parser("restart-session", help="Restart a specific session")
    restart_session_parser.add_argument("session", help="Session name")

    # restart-sessions
    subparsers.add_parser("restart-sessions", help="Restart all sessions")

    # install
    subparsers.add_parser("install", help="Install LaunchAgent for auto-start")

    # uninstall
    subparsers.add_parser("uninstall", help="Uninstall LaunchAgent")

    # menubar
    subparsers.add_parser("menubar", help="Start the menu bar app")

    # menubar-install
    subparsers.add_parser("menubar-install", help="Install menu bar LaunchAgent")

    # menubar-uninstall
    subparsers.add_parser("menubar-uninstall", help="Uninstall menu bar LaunchAgent")

    # inject-prompt
    inject_parser = subparsers.add_parser("inject-prompt", help="Inject prompt into a session")
    inject_parser.add_argument("chat_id", help="Chat ID (phone or group UUID)")
    inject_parser.add_argument("prompt", nargs="?", default="", help="Prompt text")
    inject_parser.add_argument("--bg", action="store_true", help="Target background session")
    inject_parser.add_argument("--sms", action="store_true", help="Wrap in SMS format")
    inject_parser.add_argument("--admin", action="store_true", help="Wrap in ADMIN OVERRIDE tags")
    inject_parser.add_argument("--file", "-f", help="Read prompt from file")
    inject_parser.add_argument("--reply-to", help="GUID of message being replied to (for reply chain context)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    commands = {
        "start": cmd_start,
        "stop": cmd_stop,
        "restart": cmd_restart,
        "status": cmd_status,
        "logs": cmd_logs,
        "attach": cmd_attach,
        "monitor": cmd_monitor,
        "kill-session": cmd_kill_session,
        "kill-sessions": cmd_kill_sessions,
        "restart-session": cmd_restart_session,
        "restart-sessions": cmd_restart_sessions,
        "install": cmd_install,
        "uninstall": cmd_uninstall,
        "menubar": cmd_menubar,
        "menubar-install": cmd_menubar_install,
        "menubar-uninstall": cmd_menubar_uninstall,
        "inject-prompt": cmd_inject_prompt,
    }

    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
