import React, { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

/**
 * InterruptChart
 * Bar chart of keyboard / network / disk IRQ deltas over recent ticks,
 * derived from IRQ_DELTA events.
 */
export default function InterruptChart({ events }) {
  const data = useMemo(() => {
    return events
      .filter((e) => e.type === 'IRQ_DELTA')
      .slice(-15) // last 15 ticks for readability
      .map((e) => ({
        time: new Date(e.timestamp * 1000).toLocaleTimeString(),
        keyboard: e.extra.keyboard_delta,
        net: e.extra.net_delta,
        disk: e.extra.disk_delta,
      }))
  }, [events])

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Interrupt Activity (per tick)</h3>
      {data.length === 0 ? (
        <div className="bb-empty">No interrupt data recorded yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 5, right: 12, left: -10, bottom: 5 }}>
            <CartesianGrid stroke="#2a3236" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#7d8c8f" fontSize={10} tick={{ fill: '#7d8c8f' }} />
            <YAxis stroke="#7d8c8f" fontSize={10} tick={{ fill: '#7d8c8f' }} />
            <Tooltip
              contentStyle={{ background: '#1c2225', border: '1px solid #2a3236', fontSize: 12 }}
              labelStyle={{ color: '#7d8c8f' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#7d8c8f' }} />
            <Bar dataKey="keyboard" fill="#ffb000" name="Keyboard" />
            <Bar dataKey="net" fill="#6fb7ff" name="Network (sample IRQ)" />
            <Bar dataKey="disk" fill="#5ee08c" name="Disk (sample IRQ)" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
