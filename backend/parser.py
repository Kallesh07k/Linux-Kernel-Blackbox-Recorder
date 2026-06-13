"""
parser.py - Parses the text exposed at /proc/blackbox into structured
Python dictionaries / JSON-serializable data.

The /proc/blackbox file looks like:

    # Linux Kernel Black Box Recorder
    # threshold=80
    # total_created=12 total_terminated=10
    # peak_mem_pct=45 peak_cpu_pct=78
    # irq_totals keyboard=120 net=45 disk=10
    # event_count=150
    #---
    1718000000 | BLACKBOX MODULE LOADED threshold=80%
    1718000005 | PROCESS CREATED pid=1234 comm=bash
    1718000005 | MEM STATS used=42% total_kb=8000000 used_kb=3360000
    1718000010 | MEMORY ALERT usage=85% threshold=80%
    1718000010 | CRITICAL MEMORY ALERT usage=92% threshold=90%
    1718000010 | IRQ DELTA keyboard=+2 net=+0 disk=+1 (totals kb=120 net=45 disk=10)
    1718000010 | TOP_PROC #1 pid=1 comm=systemd nvcsw=1000 nivcsw=20 utime=500 stime=300
    1718000010 | CPU STATS usage=23% peak=78%
    1718000010 | THRESHOLD UPDATED new_threshold=85%
"""

import re

PROC_PATH = "/proc/blackbox"

# Regex patterns for each event type
RE_PROCESS_CREATED = re.compile(r"^PROCESS CREATED pid=(\d+) comm=(.+)$")
RE_PROCESS_TERMINATED = re.compile(r"^PROCESS TERMINATED pid=(\d+) comm=(.+)$")
RE_MEM_STATS = re.compile(
    r"^MEM STATS used=(\d+)% total_kb=(\d+) used_kb=(\d+)$"
)
RE_MEM_ALERT = re.compile(r"^MEMORY ALERT usage=(\d+)% threshold=(\d+)%$")
RE_MEM_CRITICAL = re.compile(
    r"^CRITICAL MEMORY ALERT usage=(\d+)% threshold=(\d+)%$"
)
RE_IRQ_DELTA = re.compile(
    r"^IRQ DELTA keyboard=\+(\d+) net=\+(\d+) disk=\+(\d+) "
    r"\(totals kb=(\d+) net=(\d+) disk=(\d+)\)$"
)
RE_TOP_PROC = re.compile(
    r"^TOP_PROC #(\d+) pid=(\d+) comm=(.+?) nvcsw=(\d+) nivcsw=(\d+) "
    r"utime=(\d+) stime=(\d+)$"
)
RE_CPU_STATS = re.compile(r"^CPU STATS usage=(\d+)% peak=(\d+)%$")
RE_THRESHOLD_UPDATED = re.compile(r"^THRESHOLD UPDATED new_threshold=(\d+)%$")
RE_THRESHOLD_REJECTED = re.compile(
    r"^THRESHOLD UPDATE REJECTED invalid value=(\d+)$"
)
RE_INIT_SCAN = re.compile(r"^BLACKBOX INIT SCAN: tracking (\d+) processes$")
RE_MODULE_LOADED = re.compile(r"^BLACKBOX MODULE LOADED threshold=(\d+)%$")

# Header line patterns
RE_HDR_THRESHOLD = re.compile(r"^# threshold=(\d+)$")
RE_HDR_COUNTS = re.compile(
    r"^# total_created=(\d+) total_terminated=(\d+)$"
)
RE_HDR_PEAKS = re.compile(r"^# peak_mem_pct=(\d+) peak_cpu_pct=(\d+)$")
RE_HDR_IRQ = re.compile(
    r"^# irq_totals keyboard=(\d+) net=(\d+) disk=(\d+)$"
)
RE_HDR_EVENT_COUNT = re.compile(r"^# event_count=(\d+)$")


def read_proc_blackbox():
    """Read raw text from /proc/blackbox. Raises OSError on failure."""
    with open(PROC_PATH, "r") as f:
        return f.read()


def parse_event_line(line):
    """
    Parse a single event line of the form:
        <timestamp> | <message>
    Returns a dict with keys: timestamp, type, pid, name, value, raw
    or None if the line cannot be parsed as an event.
    """
    if "|" not in line:
        return None

    ts_part, msg_part = line.split("|", 1)
    ts_part = ts_part.strip()
    msg = msg_part.strip()

    try:
        timestamp = int(ts_part)
    except ValueError:
        return None

    event = {
        "timestamp": timestamp,
        "type": "UNKNOWN",
        "pid": None,
        "name": None,
        "value": None,
        "raw": msg,
    }

    m = RE_PROCESS_CREATED.match(msg)
    if m:
        event["type"] = "PROCESS_CREATED"
        event["pid"] = int(m.group(1))
        event["name"] = m.group(2)
        return event

    m = RE_PROCESS_TERMINATED.match(msg)
    if m:
        event["type"] = "PROCESS_TERMINATED"
        event["pid"] = int(m.group(1))
        event["name"] = m.group(2)
        return event

    m = RE_MEM_STATS.match(msg)
    if m:
        event["type"] = "MEM_STATS"
        event["value"] = int(m.group(1))
        event["extra"] = {
            "total_kb": int(m.group(2)),
            "used_kb": int(m.group(3)),
        }
        return event

    m = RE_MEM_CRITICAL.match(msg)
    if m:
        event["type"] = "CRITICAL_MEMORY_ALERT"
        event["value"] = int(m.group(1))
        event["extra"] = {"threshold": int(m.group(2))}
        return event

    m = RE_MEM_ALERT.match(msg)
    if m:
        event["type"] = "MEMORY_ALERT"
        event["value"] = int(m.group(1))
        event["extra"] = {"threshold": int(m.group(2))}
        return event

    m = RE_IRQ_DELTA.match(msg)
    if m:
        event["type"] = "IRQ_DELTA"
        event["extra"] = {
            "keyboard_delta": int(m.group(1)),
            "net_delta": int(m.group(2)),
            "disk_delta": int(m.group(3)),
            "keyboard_total": int(m.group(4)),
            "net_total": int(m.group(5)),
            "disk_total": int(m.group(6)),
        }
        return event

    m = RE_TOP_PROC.match(msg)
    if m:
        event["type"] = "TOP_PROC"
        event["pid"] = int(m.group(2))
        event["name"] = m.group(3)
        event["extra"] = {
            "rank": int(m.group(1)),
            "nvcsw": int(m.group(4)),
            "nivcsw": int(m.group(5)),
            "utime": int(m.group(6)),
            "stime": int(m.group(7)),
        }
        return event

    m = RE_CPU_STATS.match(msg)
    if m:
        event["type"] = "CPU_STATS"
        event["value"] = int(m.group(1))
        event["extra"] = {"peak": int(m.group(2))}
        return event

    m = RE_THRESHOLD_UPDATED.match(msg)
    if m:
        event["type"] = "THRESHOLD_UPDATED"
        event["value"] = int(m.group(1))
        return event

    m = RE_THRESHOLD_REJECTED.match(msg)
    if m:
        event["type"] = "THRESHOLD_REJECTED"
        event["value"] = int(m.group(1))
        return event

    m = RE_INIT_SCAN.match(msg)
    if m:
        event["type"] = "INIT_SCAN"
        event["value"] = int(m.group(1))
        return event

    m = RE_MODULE_LOADED.match(msg)
    if m:
        event["type"] = "MODULE_LOADED"
        event["value"] = int(m.group(1))
        return event

    # Fallback: unknown but recorded
    event["type"] = "OTHER"
    return event


def parse_blackbox(text=None):
    """
    Parse the full /proc/blackbox content.

    Returns a dict:
        {
            "threshold": int,
            "total_created": int,
            "total_terminated": int,
            "peak_mem_pct": int,
            "peak_cpu_pct": int,
            "irq_totals": {"keyboard": int, "net": int, "disk": int},
            "event_count": int,
            "events": [ ... parsed event dicts ..., most recent last ]
        }
    """
    if text is None:
        text = read_proc_blackbox()

    result = {
        "threshold": 80,
        "total_created": 0,
        "total_terminated": 0,
        "peak_mem_pct": 0,
        "peak_cpu_pct": 0,
        "irq_totals": {"keyboard": 0, "net": 0, "disk": 0},
        "event_count": 0,
        "events": [],
    }

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        if line.startswith("#"):
            m = RE_HDR_THRESHOLD.match(line)
            if m:
                result["threshold"] = int(m.group(1))
                continue
            m = RE_HDR_COUNTS.match(line)
            if m:
                result["total_created"] = int(m.group(1))
                result["total_terminated"] = int(m.group(2))
                continue
            m = RE_HDR_PEAKS.match(line)
            if m:
                result["peak_mem_pct"] = int(m.group(1))
                result["peak_cpu_pct"] = int(m.group(2))
                continue
            m = RE_HDR_IRQ.match(line)
            if m:
                result["irq_totals"] = {
                    "keyboard": int(m.group(1)),
                    "net": int(m.group(2)),
                    "disk": int(m.group(3)),
                }
                continue
            m = RE_HDR_EVENT_COUNT.match(line)
            if m:
                result["event_count"] = int(m.group(1))
                continue
            # other comment lines ignored
            continue

        ev = parse_event_line(line)
        if ev is not None:
            result["events"].append(ev)

    return result
