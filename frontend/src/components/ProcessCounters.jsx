import React from 'react'

/**
 * ProcessCounters
 * Displays high-level counters (processes created/exited, peaks) and a
 * table of the top processes by CPU/context-switch activity.
 */
export default function ProcessCounters({ stats }) {
  if (!stats) {
    return (
      <div className="bb-panel">
        <h3 className="bb-panel-title">Process Counters</h3>
        <div className="bb-empty">Waiting for data&hellip;</div>
      </div>
    )
  }

  const topProcs = stats.top_processes || []

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Process Counters</h3>

      <div className="bb-counter-grid" style={{ marginBottom: 18 }}>
        <div className="bb-counter">
          <div className="bb-counter-label">Created</div>
          <div className="bb-counter-value green">{stats.total_created}</div>
        </div>
        <div className="bb-counter">
          <div className="bb-counter-label">Terminated</div>
          <div className="bb-counter-value">{stats.total_terminated}</div>
        </div>
        <div className="bb-counter">
          <div className="bb-counter-label">Peak Memory</div>
          <div className="bb-counter-value blue">{stats.peak_mem_pct}%</div>
        </div>
        <div className="bb-counter">
          <div className="bb-counter-label">Peak CPU</div>
          <div className="bb-counter-value blue">{stats.peak_cpu_pct}%</div>
        </div>
      </div>

      <h3 className="bb-panel-title">Top Processes (by CPU time)</h3>
      {topProcs.length === 0 ? (
        <div className="bb-empty">No process activity recorded yet.</div>
      ) : (
        <table className="bb-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>PID</th>
              <th>Name</th>
              <th>utime</th>
              <th>stime</th>
              <th>nvcsw</th>
              <th>nivcsw</th>
            </tr>
          </thead>
          <tbody>
            {topProcs.map((p) => (
              <tr key={p.pid}>
                <td><span className="bb-rank">{p.rank}</span></td>
                <td>{p.pid}</td>
                <td>{p.name}</td>
                <td>{p.utime}</td>
                <td>{p.stime}</td>
                <td>{p.nvcsw}</td>
                <td>{p.nivcsw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
