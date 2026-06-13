import React, { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

/**
 * MemoryChart
 * Line chart of memory usage % over time, derived from MEM_STATS events.
 * Draws reference lines for the warning threshold and the (threshold+10,
 * capped at 95) critical threshold.
 */
export default function MemoryChart({ events, threshold }) {
  const data = useMemo(() => {
    return events
      .filter((e) => e.type === 'MEM_STATS')
      .map((e) => ({
        time: new Date(e.timestamp * 1000).toLocaleTimeString(),
        ts: e.timestamp,
        mem: e.value,
      }))
  }, [events])

  const criticalLine = Math.min((threshold || 80) + 10, 95)

  return (
    <div className="bb-panel">
      <h3 className="bb-panel-title">Memory Usage (%)</h3>
      {data.length === 0 ? (
        <div className="bb-empty">No memory samples recorded yet.</div>
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
            <ReferenceLine y={threshold} stroke="#ffd83d" strokeDasharray="4 4" label={{ value: `warn ${threshold}%`, fill: '#ffd83d', fontSize: 10, position: 'insideBottomRight' }} />
            <ReferenceLine y={criticalLine} stroke="#ff4d4d" strokeDasharray="4 4" label={{ value: `crit ${criticalLine}%`, fill: '#ff4d4d', fontSize: 10, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="mem" stroke="#6fb7ff" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

