#!/usr/bin/env python3
"""Check the local scheduler; Docker handles ordinary process exits."""
import json
import pathlib
import subprocess
import time
import urllib.request

STATE = pathlib.Path("/run/isle-economy-watchdog/state.json")
CONTAINER = "isle-economy"


def check(state, now, container_status, health, restart):
    status = container_status()
    if status != "running":
        phase = "container-" + (status or "unavailable")
        if phase != state.get("phase"):
            print(f"Scheduler not checked; phase={phase}", flush=True)
        state.update(failures=0, phase=phase)
        return
    try:
        phase = health()
    except (OSError, ValueError, KeyError) as error:
        state["failures"] = state.get("failures", 0) + 1
        if state["failures"] == 1:
            print(f"Scheduler health check failed: {error}", flush=True)
        if state["failures"] >= 2 and now - state.get("lastRestart", 0) >= 600:
            print("Scheduler health check failed twice; restarting container", flush=True)
            state.update(failures=0, lastRestart=now)
            try:
                restart()
            except (OSError, subprocess.SubprocessError) as error:
                print(f"Container restart failed: {error}", flush=True)
    else:
        if phase != state.get("phase") or state.get("failures"):
            print(f"Scheduler responsive; phase={phase}", flush=True)
        state.update(failures=0, phase=phase)


def container_status():
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Status}}", CONTAINER],
        text=True, capture_output=True, timeout=8,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def health():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:3020/health", timeout=4) as response:
        data = json.load(response)
    if not data.get("ok"):
        raise ValueError("scheduler reported unhealthy")
    return data["phase"]


def restart():
    subprocess.run(["docker", "restart", "--time", "20", CONTAINER], check=True, timeout=35)


def main():
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    check(state, time.time(), container_status, health, restart)
    temp = STATE.with_suffix(".new")
    temp.write_text(json.dumps(state))
    temp.replace(STATE)


if __name__ == "__main__":
    main()
