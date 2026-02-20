"""
Auto-start BlenderMCP server when Blender launches.

Usage:
    ~/blender-git/build_darwin/bin/Blender.app/Contents/MacOS/Blender --python ~/.claude/skills/blender/scripts/autostart_mcp.py &
"""
import bpy

def start_server_delayed():
    """Start the BlenderMCP server after Blender is fully loaded."""
    try:
        bpy.ops.blendermcp.start_server()
        print("BlenderMCP server started automatically on port 9876!")
        return None  # Don't repeat
    except Exception as e:
        print(f"Error starting BlenderMCP server: {e}")
        return None

# Register a timer to start the server after Blender is fully loaded
bpy.app.timers.register(start_server_delayed, first_interval=2.0)
print("BlenderMCP server auto-start scheduled...")
