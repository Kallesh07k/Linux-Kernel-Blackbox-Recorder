import React, { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

/**
 * CPUChart
 * Line chart of overall CPU usage % over time, derived from CPU_STATS events.
 */
export default function CPUChart({ events }) {
  const data = useMemo(() => {
    return events
      .filter((e) => e.type === 'CPU_STATS')
      .map((e) => ({
        time: new Date(e.timestamp * 1000).toLocaleTimeString(),
        ts: e.timestamp,
        cpu: e.value,
        peak: e.extra?.peak,
      }))
  }, [events])

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">CPU Usage (%)</h3>
      {data.length === 0 ? (
        <div className="bb-empty">No CPU samples recorded yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 5, right: 12, left: -10, bottom: 5 }}>
            <CartesianGrid stroke="#2a3236" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#7d8c8f" fontSize={10} tick={{ fill: '#7d8c8f' }} />
            <YAxis domain={[0, 100]} stroke="#7d8c8f" fontSize={10} tick={{ fill: '#7d8c8f' }} />
            <Tooltip
              contentStyle={{ background: '#1c2225', border: '1px solid #2a3236', fontSize: 12 }}
              labelStyle={{ color: '#7d8c8f' }}
            />
            <Line type="monotone" dataKey="cpu" stroke="#5ee08c" strokeWidth={2} dot={false} isAnimationActive={false} name="CPU %" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
