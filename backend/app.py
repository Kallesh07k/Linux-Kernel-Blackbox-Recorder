"""
app.py - Flask REST API for the Linux Kernel Black Box Recorder.

Endpoints:
    GET  /api/events     -> list of parsed events
    GET  /api/stats      -> summary statistics
    GET  /api/live       -> Server-Sent Events stream of new events
    POST /api/threshold  -> update memory alert threshold (writes to /proc/blackbox)
    GET  /api/export     -> download all events as CSV
"""

import time
import json

from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS

import parser as bb_parser
import exporter as bb_exporter

app = Flask(__name__)
CORS(app)

PROC_PATH = bb_parser.PROC_PATH


def load_data():
    """Read and parse /proc/blackbox. Returns parsed dict or raises."""
    return bb_parser.parse_blackbox()


@app.route("/api/events", methods=["GET"])
def get_events():
    try:
        data = load_data()
    except OSError as e:
        return jsonify({"error": f"Could not read {PROC_PATH}: {e}"}), 500

    events = data["events"]

    # Optional query filters
    ev_type = request.args.get("type")
    pid = request.args.get("pid")
    since = request.args.get("since")  # unix timestamp

    if ev_type:
        events = [e for e in events if e["type"] == ev_type]
    if pid:
        try:
            pid_int = int(pid)
            events = [e for e in events if e.get("pid") == pid_int]
        except ValueError:
            pass
    if since:
        try:
            since_int = int(since)
            events = [e for e in events if e["timestamp"] >= since_int]
        except ValueError:
            pass

    return jsonify({"count": len(events), "events": events})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    try:
        data = load_data()
    except OSError as e:
        return jsonify({"error": f"Could not read {PROC_PATH}: {e}"}), 500

    events = data["events"]

    # Compute top processes from latest TOP_PROC events (last batch)
    top_procs = {}
    for e in events:
        if e["type"] == "TOP_PROC":
            key = e["pid"]
            top_procs[key] = {
                "pid": e["pid"],
                "name": e["name"],
                "rank": e["extra"]["rank"],
                "nvcsw": e["extra"]["nvcsw"],
                "nivcsw": e["extra"]["nivcsw"],
                "utime": e["extra"]["utime"],
                "stime": e["extra"]["stime"],
            }
    top_list = sorted(top_procs.values(), key=lambda x: x["rank"])[:5]

    # Latest memory and CPU readings
    latest_mem = None
    latest_cpu = None
    for e in reversed(events):
        if latest_mem is None and e["type"] == "MEM_STATS":
            latest_mem = e["value"]
        if latest_cpu is None and e["type"] == "CPU_STATS":
            latest_cpu = e["value"]
        if latest_mem is not None and latest_cpu is not None:
            break

    # Count alerts
    mem_alerts = sum(1 for e in events if e["type"] == "MEMORY_ALERT")
    critical_alerts = sum(
        1 for e in events if e["type"] == "CRITICAL_MEMORY_ALERT"
    )

    summary = {
        "threshold": data["threshold"],
        "total_created": data["total_created"],
        "total_terminated": data["total_terminated"],
        "peak_mem_pct": data["peak_mem_pct"],
        "peak_cpu_pct": data["peak_cpu_pct"],
        "current_mem_pct": latest_mem,
        "current_cpu_pct": latest_cpu,
        "irq_totals": data["irq_totals"],
        "event_count": data["event_count"],
        "memory_alert_count": mem_alerts,
        "critical_alert_count": critical_alerts,
        "top_processes": top_list,
    }

    return jsonify(summary)


@app.route("/api/live", methods=["GET"])
def live_stream():
    """
    Server-Sent Events stream. Polls /proc/blackbox every 2 seconds and
    pushes any new events (by timestamp) that haven't been sent yet.
    """

    def event_stream():
        last_count = 0
        while True:
            try:
                data = load_data()
                events = data["events"]
                new_events = events[last_count:]
                last_count = len(events)

                for ev in new_events:
                    yield f"data: {json.dumps(ev)}\n\n"

                # heartbeat / keep-alive comment
                yield ": keep-alive\n\n"
            except OSError as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

            time.sleep(2)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/threshold", methods=["POST"])
def set_threshold():
    """
    Body: { "threshold": <int 1-100> }
    Writes "threshold=<value>" to /proc/blackbox.
    """
    body = request.get_json(silent=True) or {}
    threshold = body.get("threshold")

    if threshold is None:
        return jsonify({"error": "Missing 'threshold' field"}), 400

    try:
        threshold = int(threshold)
    except (TypeError, ValueError):
        return jsonify({"error": "'threshold' must be an integer"}), 400

    if not (1 <= threshold <= 100):
        return jsonify({"error": "'threshold' must be between 1 and 100"}), 400

    try:
        with open(PROC_PATH, "w") as f:
            f.write(f"threshold={threshold}\n")
    except OSError as e:
        return (
            jsonify(
                {
                    "error": f"Could not write to {PROC_PATH}: {e}",
                    "hint": (
                        "Ensure /proc/blackbox permissions allow writing, "
                        "or run the backend with appropriate privileges."
                    ),
                }
            ),
            500,
        )

    return jsonify({"status": "ok", "threshold": threshold})


@app.route("/api/export", methods=["GET"])
def export_csv():
    try:
        data = load_data()
    except OSError as e:
        return jsonify({"error": f"Could not read {PROC_PATH}: {e}"}), 500

    csv_text = bb_exporter.events_to_csv(data["events"])

    return Response(
        csv_text,
        mimetype="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=blackbox_events.csv"
        },
    )


@app.route("/api/health", methods=["GET"])
def health():
    proc_ok = True
    try:
        bb_parser.read_proc_blackbox()
    except OSError:
        proc_ok = False
    return jsonify({"status": "ok", "proc_blackbox_readable": proc_ok})


if __name__ == "__main__":
    # Listen on all interfaces so the Vite dev server (different port)
    # can reach it.
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
