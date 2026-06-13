import React from 'react'

const EVENT_TYPES = [
  { value: '', label: 'All types' },
  { value: 'PROCESS_CREATED', label: 'Process Created' },
  { value: 'PROCESS_TERMINATED', label: 'Process Terminated' },
  { value: 'MEM_STATS', label: 'Memory Stats' },
  { value: 'MEMORY_ALERT', label: 'Memory Alert' },
  { value: 'CRITICAL_MEMORY_ALERT', label: 'Critical Memory Alert' },
  { value: 'CPU_STATS', label: 'CPU Stats' },
  { value: 'IRQ_DELTA', label: 'Interrupt Delta' },
  { value: 'TOP_PROC', label: 'Top Process' },
  { value: 'THRESHOLD_UPDATED', label: 'Threshold Updated' },
  { value: 'INIT_SCAN', label: 'Init Scan' },
  { value: 'MODULE_LOADED', label: 'Module Loaded' },
  { value: 'OTHER', label: 'Other' },
]

/**
 * SearchFilter
 * Controls for filtering the event timeline by type, PID, or text search.
 * Filtering itself is done in the parent (Timeline) component; this is a
 * pure controlled-input view.
 */
export default function SearchFilter({ filters, onChange }) {
  const update = (key, val) => onChange({ ...filters, [key]: val })

  return (
    <div className="bb-filter-row">
      <select
        className="bb-select"
        value={filters.type}
        onChange={(e) => update('type', e.target.value)}
      >
        {EVENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      <input
        className="bb-input"
        type="text"
        placeholder="PID"
        value={filters.pid}
        onChange={(e) => update('pid', e.target.value.replace(/[^0-9]/g, ''))}
      />

      <input
        className="bb-input"
        type="text"
        placeholder="Search message&hellip;"
        value={filters.text}
        onChange={(e) => update('text', e.target.value)}
        style={{ flex: 1, minWidth: 160 }}
      />

      <button
        type="button"
        className="bb-btn secondary"
        onClick={() => onChange({ type: '', pid: '', text: '' })}
      >
        Clear
      </button>
    </div>
  )
}
