import React, { useEffect, useRef, useState } from 'react'
import './App.css'
import api, { API_BASE } from './api'

import Timeline from './components/Timeline'
import MemoryChart from './components/MemoryChart'
import CPUChart from './components/CPUChart'
import InterruptChart from './components/InterruptChart'
import AlertPanel from './components/AlertPanel'
import ProcessCounters from './components/ProcessCounters'
import ThresholdControl from './components/ThresholdControl'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'processes', label: 'Processes' },
  { id: 'settings', label: 'Settings' },
]

const POLL_INTERVAL_MS = 4000

export default function App() {
  const [events, setEvents] = useState([])
  const [stats, setStats] = useState(null)
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [lastUpdated, setLastUpdated] = useState(null)
  const eventsRef = useRef([])

  // Poll /api/events and /api/stats every few seconds.
  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const [evRes, statsRes] = await Promise.all([
          api.get('/api/events'),
          api.get('/api/stats'),
        ])
        if (cancelled) return

        setEvents(evRes.data.events)
        eventsRef.current = evRes.data.events
        setStats(statsRes.data)
        setConnected(true)
        setLastUpdated(new Date())
      } catch (err) {
        if (!cancelled) setConnected(false)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const handleThresholdUpdated = (newThreshold) => {
    setStats((prev) => (prev ? { ...prev, threshold: newThreshold } : prev))
  }

  const handleExport = () => {
    window.open(`${API_BASE}/api/export`, '_blank')
  }

  return (
    <div className="bb-app">
      <header className="bb-header">
        <div className="bb-title-group">
          <h1 className="bb-title">Blackbox</h1>
          <span className="bb-subtitle">Kernel System Event Recorder &amp; Analyzer</span>
        </div>
        <div className="bb-status">
          <span className={`bb-status-dot ${connected ? '' : 'offline'}`} />
          {connected ? 'Recorder online' : 'Recorder offline'}
          {lastUpdated && connected && (
            <span>&nbsp;&middot;&nbsp;updated {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
      </header>

      <nav className="bb-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bb-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="bb-main">
        {!connected && (
          <div className="bb-panel">
            <div className="bb-empty">
              Cannot reach the backend at {API_BASE}. Make sure the Flask
              server is running (<code>python3 app.py</code> inside{' '}
              <code>backend/</code>) and that <code>/proc/blackbox</code> exists
              (the kernel module is loaded).
            </div>
          </div>
        )}

        {activeTab === 'overview' && (
          <>
            <AlertPanel events={events} />
            <div className="bb-grid cols-2">
              <MemoryChart events={events} threshold={stats?.threshold || 80} />
              <CPUChart events={events} />
            </div>
            <div className="bb-grid">
              <InterruptChart events={events} />
              <ProcessCounters stats={stats} />
            </div>
          </>
        )}

        {activeTab === 'timeline' && (
          <Timeline events={events} />
        )}

        {activeTab === 'processes' && (
          <div className="bb-grid">
            <ProcessCounters stats={stats} />
            <div className="bb-panel">
              <h3 className="bb-panel-title">Export</h3>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-dim)' }}>
                Download the full event log as CSV for offline analysis or
                inclusion in the project report.
              </p>
              <button className="bb-btn" onClick={handleExport}>
                Export events as CSV
              </button>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bb-grid">
            <ThresholdControl
              currentThreshold={stats?.threshold}
              onUpdated={handleThresholdUpdated}
            />
            <div className="bb-panel">
              <h3 className="bb-panel-title">System Summary</h3>
              {stats ? (
                <table className="bb-table">
                  <tbody>
                    <tr><td>Event count</td><td>{stats.event_count}</td></tr>
                    <tr><td>Current memory usage</td><td>{stats.current_mem_pct ?? '—'}%</td></tr>
                    <tr><td>Current CPU usage</td><td>{stats.current_cpu_pct ?? '—'}%</td></tr>
                    <tr><td>Memory alerts</td><td>{stats.memory_alert_count}</td></tr>
                    <tr><td>Critical alerts</td><td>{stats.critical_alert_count}</td></tr>
                    <tr><td>Keyboard IRQ total</td><td>{stats.irq_totals.keyboard}</td></tr>
                    <tr><td>Network IRQ total (sample)</td><td>{stats.irq_totals.net}</td></tr>
                    <tr><td>Disk IRQ total (sample)</td><td>{stats.irq_totals.disk}</td></tr>
                  </tbody>
                </table>
              ) : (
                <div className="bb-empty">No data yet.</div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bb-footer">
        <span>Black Box Recorder &mdash; /proc/blackbox &rarr; Flask &rarr; React</span>
        <span>Advanced OS M.Tech Project</span>
      </footer>
    </div>
  )
}
