"""
exporter.py - Export parsed blackbox events as CSV.
"""

import csv
import io


CSV_FIELDS = [
    "timestamp",
    "type",
    "pid",
    "name",
    "value",
    "extra",
    "raw",
]


def events_to_csv(events):
    """
    Convert a list of parsed event dicts (see parser.parse_event_line)
    into a CSV string.
    """
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()

    for ev in events:
        row = dict(ev)
        # Flatten "extra" dict into a readable string for CSV
        extra = row.get("extra")
        if isinstance(extra, dict):
            row["extra"] = "; ".join(f"{k}={v}" for k, v in extra.items())
        writer.writerow(row)

    return output.getvalue()
