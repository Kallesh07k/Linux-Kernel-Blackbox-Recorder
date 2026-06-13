import React, { useState } from 'react'
import api from '../api'

/**
 * ThresholdControl
 * Lets the user set the memory alert threshold via POST /api/threshold,
 * which the backend writes to /proc/blackbox as "threshold=NN".
 */
export default function ThresholdControl({ currentThreshold, onUpdated }) {
  const [value, setValue] = useState(currentThreshold || 80)
  const [status, setStatus] = useState(null) // { ok: bool, msg: string }
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await api.post('/api/threshold', { threshold: Number(value) })
      setStatus({ ok: true, msg: `Threshold updated to ${res.data.threshold}%` })
      if (onUpdated) onUpdated(res.data.threshold)
    } catch (err) {
      const msg = err.response?.data?.error || err.message
      setStatus({ ok: false, msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Memory Alert Threshold</h3>
      <form className="bb-threshold-form" onSubmit={handleSubmit}>
        <input
          type="number"
          min="1"
          max="100"
          className="bb-threshold-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="bb-threshold-current">%</span>
        <button type="submit" className="bb-btn" disabled={submitting}>
          {submitting ? 'Updating&hellip;' : 'Set threshold'}
        </button>
        <span className="bb-threshold-current">
          current: {currentThreshold != null ? `${currentThreshold}%` : '—'}
        </span>
      </form>
      {status && (
        <div className={`bb-threshold-msg ${status.ok ? '' : 'error'}`} style={{ marginTop: 10 }}>
          {status.msg}
        </div>
      )}
    </div>
  )
}
