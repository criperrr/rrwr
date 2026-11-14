#!/usr/bin/env python3
"""
measure_app_audio.py - Empirically measure audio output from RRWR (WebKitWebProcess).

Isolates the specific audio sink-input/node belonging to RRWR / WebKitWebProcess,
verifies that external audio sources (e.g. Firefox) are strictly excluded,
records raw PCM audio for a specified duration, and calculates RMS and peak amplitude.
"""

import sys
import os
import subprocess
import json
import time
import struct
import math
import argparse

def get_rrwr_pids():
    """Returns a set of PIDs belonging to rrwr and WebKitWebProcess."""
    pids = set()
    try:
        out = subprocess.check_output(["pgrep", "-f", "rrwr|WebKitWebProcess"]).decode()
        for line in out.strip().splitlines():
            line = line.strip()
            if line:
                pids.add(int(line))
    except Exception:
        pass
    return pids

def find_rrwr_sink_inputs():
    """Finds PulseAudio/PipeWire sink-inputs belonging strictly to RRWR."""
    rrwr_pids = get_rrwr_pids()
    try:
        out = subprocess.check_output(["pactl", "list", "sink-inputs"]).decode("utf-8", errors="replace")
    except Exception as e:
        print(f"Error executing pactl: {e}", file=sys.stderr)
        return []

    sink_inputs = []
    current = {}
    
    for line in out.splitlines():
        line_str = line.strip()
        if line_str.startswith("Sink Input #"):
            if current:
                sink_inputs.append(current)
            current = {"id": line_str.split("#")[1].strip(), "properties": {}}
        elif line_str.startswith("Properties:"):
            continue
        elif "=" in line_str and current and not line_str.startswith("Volume:"):
            prop_parts = line_str.split("=", 1)
            p_key = prop_parts[0].strip()
            p_val = prop_parts[1].strip().strip('"')
            current["properties"][p_key] = p_val
        elif ":" in line_str and current:
            parts = line_str.split(":", 1)
            key = parts[0].strip()
            val = parts[1].strip()
            if key == "Corked":
                current["corked"] = (val.lower() == "yes")
            elif key == "Mute":
                current["mute"] = (val.lower() == "yes")
            elif key == "Volume":
                current["volume_str"] = val
            else:
                current[key] = val

    if current:
        sink_inputs.append(current)

    rrwr_streams = []
    for s in sink_inputs:
        props = s.get("properties", {})
        pid_str = props.get("application.process.id")
        binary = props.get("application.process.binary", "")
        app_name = props.get("application.name", "")
        
        is_rrwr = False
        if pid_str:
            try:
                pid = int(pid_str)
                if pid in rrwr_pids:
                    is_rrwr = True
            except ValueError:
                pass
        
        if "WebKitWebProcess" in binary or "rrwr" in binary or "rrwr" in app_name.lower():
            is_rrwr = True
            
        if is_rrwr:
            rrwr_streams.append(s)

    return rrwr_streams

def measure_stream_audio(sink_input_id, serial=None, duration=1.5):
    """Records audio directly from the specific sink input using pw-record and computes RMS."""
    try:
        subprocess.run(["pactl", "set-sink-input-mute", str(sink_input_id), "0"], check=False)
        subprocess.run(["pactl", "set-sink-input-volume", str(sink_input_id), "100%"], check=False)
    except Exception:
        pass

    target_id = serial if serial else sink_input_id
    wav_file = f"/tmp/rrwr_audio_test_{sink_input_id}.wav"
    if os.path.exists(wav_file):
        os.remove(wav_file)

    cmd = [
        "pw-record",
        "--target", str(target_id),
        wav_file
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(duration)
    proc.terminate()
    try:
        proc.wait(timeout=1.0)
    except Exception:
        proc.kill()

    if not os.path.exists(wav_file) or os.path.getsize(wav_file) == 0:
        return 0.0, 0.0, 0

    try:
        import wave
        with wave.open(wav_file, "rb") as w:
            n_frames = w.getnframes()
            frames = w.readframes(n_frames)
            if not frames:
                return 0.0, 0.0, 0
            samples = struct.unpack(f"<{len(frames)//2}h", frames)
            sample_count = len(samples)
            sum_sq = sum((s / 32768.0) ** 2 for s in samples)
            peak = max(abs(s) / 32768.0 for s in samples)
            rms = math.sqrt(sum_sq / sample_count)
    except Exception:
        return 0.0, 0.0, 0
    finally:
        if os.path.exists(wav_file):
            os.remove(wav_file)

    return rms, peak, sample_count

def main():
    parser = argparse.ArgumentParser(description="Empirically verify RRWR isolated audio output.")
    parser.add_argument("--duration", type=float, default=1.5, help="Recording sample duration in seconds")
    parser.add_argument("--unmute-only", action="store_true", help="Unmute and exit")
    args = parser.parse_args()

    streams = find_rrwr_sink_inputs()
    if not streams:
        print("NO_RRWR_AUDIO_STREAMS_FOUND")
        sys.exit(2)

    all_passed = True
    print(f"Found {len(streams)} RRWR audio stream(s):")
    for s in streams:
        s_id = s.get("id")
        props = s.get("properties", {})
        binary = props.get("application.process.binary", "unknown")
        pid = props.get("application.process.id", "unknown")
        media_name = props.get("media.name", "unknown")
        corked = s.get("corked", False)
        mute = s.get("mute", False)
        serial = props.get("object.serial") or s_id

        print(f"--- Sink Input #{s_id} ---")
        print(f"  Binary: {binary} (PID {pid})")
        print(f"  Media: {media_name}")
        print(f"  Serial: {serial}")
        print(f"  Corked: {corked}, Mute: {mute}")

        if args.unmute_only:
            subprocess.run(["pactl", "set-sink-input-mute", str(s_id), "0"], check=False)
            subprocess.run(["pactl", "set-sink-input-volume", str(s_id), "100%"], check=False)
            continue

        rms, peak, samples = measure_stream_audio(s_id, serial=serial, duration=args.duration)
        print(f"  Measured Samples: {samples}")
        print(f"  Peak Amplitude: {peak:.4f}")
        print(f"  RMS Energy: {rms:.4f}")

        if rms > 0.005:
            print("  Status: ACTIVE_AUDIO_CONFIRMED")
        else:
            print("  Status: SILENT_STREAM")
            all_passed = False

    if all_passed:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
