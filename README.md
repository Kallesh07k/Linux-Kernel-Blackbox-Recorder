# Blackbox — Linux Kernel Black Box Recorder & System Event Analyzer

## Overview

Blackbox is an Advanced Operating Systems project that acts as a Linux system "black box recorder." Similar to an aircraft black box, it continuously records important system events and resource statistics at the kernel level and provides real-time monitoring through a web dashboard.

The project consists of a Linux Kernel Module for event collection, a Flask backend for data processing and API services, and a React frontend for visualization and analysis.

---

## Features

### System Monitoring

* Process creation tracking
* Process termination tracking
* Memory usage monitoring
* CPU utilization monitoring
* Interrupt activity monitoring
* Context switch statistics
* Top CPU-consuming processes

### Alerting System

* Configurable memory thresholds
* Memory warning alerts
* Critical memory alerts
* Real-time event notifications

### Dashboard Features

* Live event timeline
* Memory utilization charts
* CPU usage charts
* Interrupt activity charts
* Process statistics
* Alert monitoring panel
* Dynamic threshold configuration

### Data Management

* Kernel event ring buffer
* REST API support
* Server-Sent Events (SSE)
* CSV export functionality

---

## System Architecture

```text
┌─────────────────────┐
│ Linux Kernel Module │
└──────────┬──────────┘
           │
           ▼
    /proc/blackbox
           │
           ▼
┌─────────────────────┐
│   Flask Backend     │
│  REST API + SSE     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ React Dashboard     │
│ Real-Time Analytics │
└─────────────────────┘
```

---

## Technology Stack

### Kernel Space

* C Programming
* Linux Kernel Modules
* ProcFS
* Kernel Timers
* Linux Scheduling APIs

### Backend

* Python 3
* Flask
* Flask-CORS

### Frontend

* React
* Vite
* Axios
* Recharts

### Platform

* Ubuntu Linux
* VMware Workstation

---

## Project Structure

```text
Linux-Kernel-Blackbox-Recorder/
│
├── kernel/
│   ├── blackbox.c
│   └── Makefile
│
├── backend/
│   ├── app.py
│   ├── parser.py
│   ├── exporter.py
│   └── requirements.txt
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│
├── run.sh
├── README.md
└── .gitignore
```

---

## Installation

### Clone Repository

```bash
git clone https://github.com/Kallesh07k/Linux-Kernel-Blackbox-Recorder.git

cd Linux-Kernel-Blackbox-Recorder
```

### Install Dependencies

```bash
sudo apt update

sudo apt install -y \
build-essential \
linux-headers-$(uname -r) \
python3 \
python3-pip \
python3-venv \
nodejs \
npm
```

---

## Running the Project

### Step 1: Build and Load Kernel Module

```bash
cd kernel

make

sudo insmod blackbox.ko

sudo chmod 666 /proc/blackbox
```

Verify:

```bash
cat /proc/blackbox
```

---

### Step 2: Start Backend

Open a new terminal:

```bash
cd backend

python3 -m venv venv

source venv/bin/activate

pip install -r requirements.txt

python3 app.py
```

Backend runs on:

```text
http://localhost:5000
```

---

### Step 3: Start Frontend

Open another terminal:

```bash
cd frontend

npm install

npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

---

### Step 4: Open Dashboard

Open:

```text
http://localhost:5173
```

You should see:

* Overview Dashboard
* Live Event Timeline
* CPU Monitoring
* Memory Monitoring
* Interrupt Statistics
* Alert Panel
* Process Statistics

---

## Sample Events

```text
PROCESS CREATED pid=2541 comm=firefox

PROCESS TERMINATED pid=2541 comm=firefox

MEMORY ALERT usage=87%

CRITICAL MEMORY ALERT usage=94%

CPU USAGE usage=78%

IRQ DELTA keyboard=12 network=25 disk=8
```

---

## Operating System Concepts Covered

### Process Management

* Process Creation
* Process Termination
* task_struct
* Process Statistics

### CPU Scheduling

* Context Switching
* Scheduling Metrics
* CPU Utilization Analysis

### Interrupt Handling

* IRQ Monitoring
* Interrupt Statistics
* Event Recording

### Memory Management

* System Memory Monitoring
* Memory Pressure Detection
* Alert Generation

### Kernel Programming

* Linux Kernel Modules
* ProcFS
* Kernel Timers
* Ring Buffers
* Spinlocks

---

## Applications

* Linux System Monitoring
* Performance Analysis
* Resource Usage Tracking
* Operating Systems Education
* Kernel Development Learning
* Fault Diagnosis and Debugging

---

## Author

**Kallesh Achar**

M.Tech – Computer Science & Engineering

Advanced Operating Systems Project

---

## License

This project is developed for academic and educational purposes.
