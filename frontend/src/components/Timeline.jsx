import React, { useMemo, useState } from 'react'
import SearchFilter from './SearchFilter'

const BADGE_CLASS = {
  PROCESS_CREATED: 'created',
  PROCESS_TERMINATED: 'terminated',
  MEM_STATS: 'mem',
  MEMORY_ALERT: 'alert',
  CRITICAL_MEMORY_ALERT: 'critical',
  CPU_STATS: 'cpu',
  IRQ_DELTA: 'irq',
  TOP_PROC: 'top',
  THRESHOLD_UPDATED: 'threshold',
  THRESHOLD_REJECTED: 'threshold',
  INIT_SCAN: 'other',
  MODULE_LOADED: 'other',
  OTHER: 'other',
}

const BADGE_LABEL = {
  PROCESS_CREATED: 'CREATED',
  PROCESS_TERMINATED: 'TERMINATED',
  MEM_STATS: 'MEM',
  MEMORY_ALERT: 'MEM ALERT',
  CRITICAL_MEMORY_ALERT: 'CRITICAL',
  CPU_STATS: 'CPU',
  IRQ_DELTA: 'IRQ',
  TOP_PROC: 'TOP PROC',
  THRESHOLD_UPDATED: 'THRESHOLD',
  THRESHOLD_REJECTED: 'THRESHOLD',
  INIT_SCAN: 'INIT',
  MODULE_LOADED: 'MODULE',
  OTHER: 'EVENT',
}

/**
 * Timeline
 * Live scrolling event timeline. Receives the full event list (refreshed
 * by the parent App via polling/SSE) and applies local search filters.
 */
export default function Timeline({ events }) {
  const [filters, setFilters] = useState({ type: '', pid: '', text: '' })

  const filtered = useMemo(() => {
    let list = events
    if (filters.type) {
      list = list.filter((e) => e.type === filters.type)
    }
    if (filters.pid) {
      const pidNum = Number(filters.pid)
      list = list.filter((e) => e.pid === pidNum)
    }
    if (filters.text) {
      const t = filters.text.toLowerCase()
      list = list.filter((e) => e.raw.toLowerCase().includes(t))
    }
    return list.slice().reverse() // most recent first
  }, [events, filters])

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Live Event Timeline</h3>

      <div style={{ marginBottom: 14 }}>
        <SearchFilter filters={filters} onChange={setFilters} />
      </div>

      {filtered.length === 0 ? (
        <div className="bb-empty">No events match the current filter.</div>
      ) : (
        <div className="bb-timeline">
          {filtered.map((e, idx) => (
            <div className="bb-event-row" key={`${e.timestamp}-${idx}`}>
              <span className="bb-event-time">
                {new Date(e.timestamp * 1000).toLocaleTimeString()}
              </span>
              <span className={`bb-event-badge ${BADGE_CLASS[e.type] || 'other'}`}>
                {BADGE_LABEL[e.type] || e.type}
              </span>
              <span className="bb-event-msg" title={e.raw}>{e.raw}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
