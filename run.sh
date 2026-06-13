#!/bin/bash
#
# run.sh - Helper script to build the kernel module, load it, start the
# Flask backend, and start the React dev server.
#
# Usage:
#   ./run.sh build    -> build the kernel module
#   ./run.sh load     -> insmod the kernel module + set /proc permissions
#   ./run.sh unload   -> rmmod the kernel module
#   ./run.sh backend  -> start Flask backend (foreground)
#   ./run.sh frontend -> start React dev server (foreground)
#   ./run.sh all      -> build + load + start backend & frontend (background)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL_DIR="$SCRIPT_DIR/kernel"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

build_kernel() {
    echo "==> Building kernel module..."
    make -C "$KERNEL_DIR"
    echo "==> Build complete: $KERNEL_DIR/blackbox.ko"
}

load_kernel() {
    echo "==> Loading kernel module..."
    if lsmod | grep -q '^blackbox'; then
        echo "Module already loaded, removing first..."
        sudo rmmod blackbox
    fi
    sudo insmod "$KERNEL_DIR/blackbox.ko"
    echo "==> Module loaded. Setting /proc/blackbox permissions to 0666..."
    sudo chmod 666 /proc/blackbox
    echo "==> Done. Check with: cat /proc/blackbox"
}

unload_kernel() {
    echo "==> Unloading kernel module..."
    sudo rmmod blackbox
}

start_backend() {
    echo "==> Starting Flask backend..."
    cd "$BACKEND_DIR"
    if [ ! -d venv ]; then
        python3 -m venv venv
    fi
    source venv/bin/activate
    pip install -q -r requirements.txt
    python3 app.py
}

start_frontend() {
    echo "==> Starting React dev server..."
    cd "$FRONTEND_DIR"
    if [ ! -d node_modules ]; then
        npm install
    fi
    npm run dev
}

run_all() {
    build_kernel
    load_kernel

    echo "==> Starting backend in background (logs: $SCRIPT_DIR/backend.log)..."
    (
        cd "$BACKEND_DIR"
        if [ ! -d venv ]; then python3 -m venv venv; fi
        source venv/bin/activate
        pip install -q -r requirements.txt
        python3 app.py
    ) > "$SCRIPT_DIR/backend.log" 2>&1 &
    echo "Backend PID: $!"

    sleep 2

    echo "==> Starting frontend (foreground)..."
    cd "$FRONTEND_DIR"
    if [ ! -d node_modules ]; then npm install; fi
    npm run dev
}

case "$1" in
    build)    build_kernel ;;
    load)     load_kernel ;;
    unload)   unload_kernel ;;
    backend)  start_backend ;;
    frontend) start_frontend ;;
    all)      run_all ;;
    *)
        echo "Usage: $0 {build|load|unload|backend|frontend|all}"
        exit 1
        ;;
esac
