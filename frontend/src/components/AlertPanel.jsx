import React, { useMemo } from 'react'

/**
 * AlertPanel
 * Shows recent CRITICAL MEMORY ALERT events in red and MEMORY ALERT
 * warnings in yellow, most recent first.
 */
export default function AlertPanel({ events }) {
  const alerts = useMemo(() => {
    return events
      .filter((e) => e.type === 'CRITICAL_MEMORY_ALERT' || e.type === 'MEMORY_ALERT')
      .slice(-10)
      .reverse()
  }, [events])

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Alerts</h3>
      {alerts.length === 0 ? (
        <div className="bb-alert empty">
          <span className="bb-alert-icon">&#9711;</span>
          No active alerts. System within configured thresholds.
        </div>
      ) : (
        alerts.map((a, idx) => {
          const isCritical = a.type === 'CRITICAL_MEMORY_ALERT'
          return (
            <div key={`${a.timestamp}-${idx}`} className={`bb-alert ${isCritical ? 'critical' : 'warning'}`}>
              <span className="bb-alert-icon">{isCritical ? '\u26A0' : '\u26A0'}</span>
              <span>
                {isCritical ? 'CRITICAL MEMORY ALERT' : 'MEMORY ALERT'} &mdash; usage {a.value}%
                {a.extra?.threshold ? ` (threshold ${a.extra.threshold}%)` : ''}
                {' '}at {new Date(a.timestamp * 1000).toLocaleTimeString()}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
