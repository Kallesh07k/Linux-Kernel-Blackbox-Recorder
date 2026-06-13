# Blackbox — Linux Kernel Black Box Recorder & System Event Analyzer

An Advanced OS (M.Tech) project that builds a Linux loadable kernel module
which periodically records system events (process creation/termination,
memory pressure, CPU usage, interrupt activity, and per-process context
switches) into an in-kernel ring buffer exposed via `/proc/blackbox`. A
Flask backend parses this data and exposes a REST/SSE API, which a React
dashboard visualizes in real time.

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                         KERNEL SPACE                              │
 │                                                                    │
 │  ┌────────────────┐   timer (5s)    ┌─────────────────────────┐  │
 │  │ kernel timer    │ ───────────────▶│ bb_timer_callback()      │  │
 │  │ (struct         │                 │  - for_each_process()    │  │
 │  │  timer_list)    │                 │  - si_meminfo()           │  │
 │  └────────────────┘                 │  - kstat_irqs_cpu()       │  │
 │                                       │  - nvcsw / nivcsw         │  │
 │                                       │  - cpustat[] usage        │  │
 │                                       └────────────┬─────────────┘  │
 │                                                     │ bb_add_event() │
 │                                                     ▼                │
 │                              ┌──────────────────────────────────┐  │
 │                              │ ring buffer (list_head, 200 max)  │  │
 │                              │  protected by spinlock            │  │
 │                              └────────────────┬───────────────────┘  │
 │                                                │                       │
 │                              ┌─────────────────▼────────────────┐    │
 │                              │  /proc/blackbox (proc_ops)         │    │
 │                              │  read  -> seq_file dump            │    │
 │                              │  write -> "threshold=NN"            │    │
 │                              └─────────────────┬────────────────┘    │
 └────────────────────────────────────────────────┼─────────────────────┘
                                                    │ read/write
                                                    ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                         USER SPACE                                │
 │                                                                    │
 │  ┌────────────────┐   parses    ┌────────────────────────────┐  │
 │  │ parser.py        │◀──────────│ /proc/blackbox text          │  │
 │  └────────┬────────┘             └────────────────────────────┘  │
 │           │ structured events                                     │
 │           ▼                                                        │
 │  ┌────────────────────────────────────────────────────────────┐  │
 │  │ Flask app.py (REST + SSE)                                    │  │
 │  │  GET  /api/events     GET  /api/stats   GET /api/live        │  │
 │  │  POST /api/threshold  GET  /api/export (exporter.py -> CSV)  │  │
 │  └────────────────────────────┬─────────────────────────────────┘  │
 │                                │ HTTP (axios)                        │
 │                                ▼                                      │
 │  ┌────────────────────────────────────────────────────────────┐    │
 │  │ React + Vite dashboard (frontend/)                           │    │
 │  │  Timeline | MemoryChart | CPUChart | InterruptChart |        │    │
 │  │  AlertPanel | ProcessCounters | ThresholdControl             │    │
 │  └────────────────────────────────────────────────────────────┘    │
 └─────────────────────────────────────────────────────────────────┘
```

## Folder structure

```
blackbox-project/
├── kernel/
│   ├── blackbox.c        # the kernel module
│   └── Makefile           # standard out-of-tree module Makefile
├── backend/
│   ├── app.py             # Flask REST + SSE API
│   ├── parser.py          # parses /proc/blackbox text -> JSON
│   ├── exporter.py         # events -> CSV
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── App.css
│       ├── index.css
│       ├── api.js
│       └── components/
│           ├── Timeline.jsx
│           ├── MemoryChart.jsx
│           ├── CPUChart.jsx
│           ├── InterruptChart.jsx
│           ├── AlertPanel.jsx
│           ├── ProcessCounters.jsx
│           ├── ThresholdControl.jsx
│           └── SearchFilter.jsx
├── run.sh
└── README.md
```

---

## Step-by-step setup (Ubuntu 24.04, kernel 6.17.x)

### a) System prep

```bash
sudo apt update
sudo apt install -y build-essential linux-headers-$(uname -r) git \
    python3 python3-venv python3-pip curl
```

For Node.js/npm, use either apt or nvm:

```bash
# Option 1: apt (simplest)
sudo apt install -y nodejs npm

# Option 2: nvm (recommended for a recent Node version)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
```

### b) Verify kernel headers match your running kernel

```bash
uname -r
ls /lib/modules/$(uname -r)/build
```

The second command must list files (it's a symlink into the headers
package). If it doesn't exist, reinstall headers:

```bash
sudo apt install --reinstall linux-headers-$(uname -r)
```

### c) Build the kernel module

```bash
cd blackbox-project/kernel
make
```

Expected output ends with something like:

```
  LD [M]  blackbox.ko
  MODPOST Module.symvers
  ...
```

This produces `blackbox.ko` in `kernel/`, along with build artifacts
(`*.o`, `*.mod.c`, `Module.symvers`, etc.) which are safe to ignore (and
are covered by `.gitignore`).

### d) Load the module

```bash
sudo insmod blackbox.ko
lsmod | grep blackbox
dmesg | tail -n 20
```

You should see `blackbox: module loaded, /proc/blackbox created` in
`dmesg`.

### e) Test the /proc interface

```bash
cat /proc/blackbox
echo "threshold=85" | sudo tee /proc/blackbox
cat /proc/blackbox | head -n 6
```

The second command updates the in-kernel memory alert threshold to 85%;
you should see a `THRESHOLD UPDATED new_threshold=85%` line appear.

By default `/proc/blackbox` is created with permissions `0666`
(world-readable and writable), so the Flask backend should be able to
read and write it without `sudo`. If your system's `/proc` mount options
or umask restrict this, fix permissions explicitly:

```bash
sudo chmod 666 /proc/blackbox
```

### f) Unload / reload during development

```bash
sudo rmmod blackbox

# after editing blackbox.c:
cd blackbox-project/kernel
make clean
make
sudo insmod blackbox.ko
sudo chmod 666 /proc/blackbox
```

(`make reload` in the Makefile does unload + rebuild + reload in one
step, but requires passwordless or already-cached `sudo`.)

### g) Backend setup

```bash
cd blackbox-project/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Notes:
- On Ubuntu 24.04, `pip install` outside a venv is blocked by PEP 668
  ("externally-managed-environment"). Using a venv (as above) avoids this
  entirely.
- The backend does **not** need to run as root, as long as
  `/proc/blackbox` is `0666` (set in step e/f, or automatically by
  `run.sh load`). If you see "Permission denied" errors on `/api/events`
  or `/api/threshold`, re-run `sudo chmod 666 /proc/blackbox`.

### h) Test the backend

In another terminal (with the backend running):

```bash
curl http://localhost:5000/api/events
curl http://localhost:5000/api/stats
curl -X POST http://localhost:5000/api/threshold \
     -H "Content-Type: application/json" \
     -d '{"threshold": 75}'
curl http://localhost:5000/api/export -o blackbox_events.csv
```

### i) Frontend setup

```bash
cd blackbox-project/frontend
npm install
npm run dev
```

Open the URL Vite prints, typically:

```
http://localhost:5173
```

If your VM is accessed remotely and `localhost` in the browser doesn't
resolve to the VM, edit `frontend/src/api.js` and change `API_BASE` to
the VM's IP address (e.g. `http://192.168.1.50:5000`), and start Vite
with `npm run dev -- --host` so it's reachable too.

### j) Verify end-to-end

With the kernel module loaded, backend running, and frontend open:

```bash
# generate a new process (will show as PROCESS CREATED, then TERMINATED)
sleep 100 &

# generate memory pressure (use with care; adjust size for your VM's RAM)
sudo apt install -y stress-ng
stress-ng --vm 2 --vm-bytes 80% --timeout 30s
```

Within ~5-10 seconds (one or two timer ticks) you should see:
- A `PROCESS CREATED` event for the new `sleep`/`stress-ng` processes
- Memory usage % climbing in the Memory chart
- A `MEMORY ALERT` or `CRITICAL MEMORY ALERT` if usage crosses the
  threshold
- CPU usage % rising in the CPU chart
- New `TOP_PROC` entries reflecting the busy processes

### k) Troubleshooting

| Problem | Cause / Fix |
|---|---|
| `make` fails: "no such file or directory ... /lib/modules/.../build" | Kernel headers not installed / mismatched. Run `sudo apt install --reinstall linux-headers-$(uname -r)` and confirm `uname -r` matches the headers package version. |
| `insmod: ERROR: could not insert module blackbox.ko: Operation not permitted` | Usually Secure Boot blocking unsigned modules. In VMware: power off the VM, go to VM Settings, check the firmware/EFI options, boot into UEFI firmware setup (hold Shift in GRUB, or `systemctl reboot --firmware-setup`), and disable Secure Boot. Alternatively, sign the module with a MOK key. |
| `cat /proc/blackbox`: "Permission denied" | Run `sudo chmod 666 /proc/blackbox`. Repeat after each reload (insmod). |
| Flask `/api/events` returns 500 "Could not read /proc/blackbox" | Module not loaded (`lsmod | grep blackbox`), or permissions issue - see above. |
| `Address already in use` on port 5000 | Another process is using it: `sudo lsof -i :5000` then `kill <pid>`, or change the port in `app.py`'s `app.run(...)` call and `frontend/src/api.js`. |
| `Address already in use` on port 5173 | Vite usually auto-picks the next free port (5174, etc.) - check the terminal output, or `lsof -i :5173` to find/kill the conflicting process. |
| CORS errors in browser console | Ensure `flask-cors` is installed (`pip install -r requirements.txt`) and that `CORS(app)` is present in `app.py` (it is, by default). Confirm `API_BASE` in `frontend/src/api.js` points to the correct host/port. |
| `sudo rmmod blackbox` fails: "Module is in use" | Something has `/proc/blackbox` open. Find it with `sudo lsof /proc/blackbox` (or `sudo fuser /proc/blackbox`) and stop that process - commonly the Flask `/api/live` SSE stream, so stop the backend first. |

---

## Explanation: kernel concepts mapped to code

- **`task_struct` / `for_each_process()`**: Each timer tick walks the
  kernel's process list under `rcu_read_lock()`, reading `task->pid` and
  `task->comm` (process name) to build a snapshot. Diffing this against
  the previous tick's snapshot detects `PROCESS CREATED` and `PROCESS
  TERMINATED` events without hooking `fork`/`exit` directly.

- **`si_meminfo()`**: Fills a `struct sysinfo` with `totalram`,
  `freeram`, and `bufferram` in pages. The module converts these to KB
  (`<< (PAGE_SHIFT - 10)`) and computes `used% = used_kb * 100 /
  total_kb`. If usage crosses `mem_threshold` (default 80%, settable via
  `/proc/blackbox`), a `MEMORY ALERT` is logged; if it crosses
  `threshold + 10` (capped at 95%), a `CRITICAL MEMORY ALERT` is logged.

- **`struct timer_list` / `mod_timer()`**: `timer_setup()` registers
  `bb_timer_callback` once at module load. At the end of every callback,
  `mod_timer()` re-arms the timer for `+5000ms`, creating a recurring
  5-second tick without a dedicated kernel thread.

- **ProcFS (`/proc/blackbox`)**: Created with `proc_create()` and a
  `struct proc_ops` providing `seq_file`-based reads (`bb_proc_show`
  dumps header metadata plus the ring buffer contents) and a custom
  `bb_proc_write` that parses `"threshold=NN"` strings written via
  `echo ... > /proc/blackbox`, validates the range (1-100), updates
  `mem_threshold`, and logs a `THRESHOLD UPDATED` event.

- **Ring buffer / `list_head`**: Events are kernel-allocated
  `struct bb_event` nodes linked via the kernel's intrusive doubly-linked
  list (`struct list_head`). `bb_add_event()` appends to the tail and, if
  the count exceeds `MAX_EVENTS` (200), removes and frees the oldest
  (head) node - a circular/bounded buffer implemented with a linked list.
  All access is serialized with a `spinlock_t` (`bb_lock`) since the
  timer callback runs in timer context while `/proc/blackbox` reads
  happen in process context.

- **Interrupts (`kstat_irqs_cpu`)**: The module sums per-CPU interrupt
  counts for a small set of representative IRQ lines (keyboard = IRQ 1,
  plus two illustrative lines for "network-like" and "disk-like"
  activity, since exact IRQ numbers vary by platform/virtualization). It
  logs the delta since the last tick as `IRQ DELTA`, and maintains
  running totals.

- **Context switches (`task->nvcsw` / `task->nivcsw`)**: For every
  process scanned, the module records voluntary and involuntary context
  switch counts plus `utime`/`stime`. A small insertion-sort keeps the
  top 5 processes by total CPU time (`utime + stime`), logged each tick
  as `TOP_PROC #1..#5`.

- **CPU usage estimate**: Using `kcpustat_cpu()` per-CPU accounting
  (`CPUTIME_USER`, `_NICE`, `_SYSTEM`, `_IDLE`, `_IOWAIT`, `_IRQ`,
  `_SOFTIRQ`), the module computes `(delta_total - delta_idle) /
  delta_total * 100` as an overall CPU busy percentage, tracking a
  running peak.

## Data flow: kernel -> /proc -> Flask -> React

1. Every 5 seconds, `bb_timer_callback` runs in the kernel, scans system
   state, and appends human-readable lines (e.g. `"PROCESS CREATED
   pid=1234 comm=bash"`) to the in-memory ring buffer.
2. Reading `/proc/blackbox` (via `cat`, or Flask's `open()`) triggers
   `bb_proc_show`, which serializes the header metadata and all current
   ring-buffer entries as plain text.
3. `backend/parser.py`'s `parse_blackbox()` reads that text, parses the
   header comment lines (threshold, totals, peaks, IRQ totals) and each
   event line into a typed dict (`type`, `pid`, `name`, `value`, `extra`,
   `raw`) using per-event-type regexes.
4. `backend/app.py` exposes this structured data via:
   - `GET /api/events` (optionally filtered by `type`, `pid`, `since`)
   - `GET /api/stats` (aggregated summary + top processes)
   - `GET /api/live` (Server-Sent Events - polls `/proc/blackbox` every
     2s server-side and streams only newly-appended events)
   - `POST /api/threshold` (writes `"threshold=NN"` back to
     `/proc/blackbox`, which the kernel module's write handler validates
     and applies)
   - `GET /api/export` (via `backend/exporter.py`, flattens events to
     CSV)
5. The React app (`frontend/src/App.jsx`) polls `/api/events` and
   `/api/stats` every 4 seconds via axios, feeding the data into:
   - `Timeline` - scrolling, filterable raw event log
   - `MemoryChart` / `CPUChart` - Recharts line charts over time
   - `InterruptChart` - Recharts bar chart of IRQ deltas
   - `AlertPanel` - highlights active `MEMORY ALERT` / `CRITICAL MEMORY
     ALERT` events
   - `ProcessCounters` - totals + top-5 process table
   - `ThresholdControl` - posts new thresholds back through the chain to
     the kernel module

## Demoing live for a project viva

1. Start everything: `./run.sh load` (kernel), then `./run.sh backend`
   and `./run.sh frontend` in separate terminals (or `./run.sh all`).
2. Show `cat /proc/blackbox` in a terminal - point out the header line
   and raw event format.
3. Open the dashboard (Overview tab). Point out the live "Recorder
   online" indicator and current memory/CPU charts.
4. **Trigger process events**: run `sleep 60 &` a few times in another
   terminal - within one tick, `PROCESS CREATED` events appear in the
   Timeline tab; after `sleep` exits, `PROCESS TERMINATED` appears.
5. **Trigger memory alerts**: run
   `stress-ng --vm 1 --vm-bytes 85% --timeout 20s` (install via
   `sudo apt install stress-ng` if needed). Watch the Memory chart climb
   and a `MEMORY ALERT` / `CRITICAL MEMORY ALERT` appear in the Alerts
   panel.
6. **Trigger CPU load**: run `stress-ng --cpu 4 --timeout 20s`. Watch the
   CPU chart rise and `TOP_PROC` entries in the Processes tab update.
7. **Demonstrate dynamic configuration**: in the Settings tab, change the
   memory threshold (e.g. to 50%) and click "Set threshold" - show the
   resulting `THRESHOLD UPDATED` event in the Timeline, and confirm via
   `cat /proc/blackbox | grep threshold`.
8. **Export data**: in the Processes tab, click "Export events as CSV"
   and open the downloaded file to show structured data ready for
   analysis/report inclusion.
9. **Generate interrupts**: type rapidly in the terminal (keyboard IRQs)
   and watch the Interrupt chart's "Keyboard" bars increase on the next
   tick.
