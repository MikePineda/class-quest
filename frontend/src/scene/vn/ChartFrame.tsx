/**
 * `chart_frame`, at reading size.
 *
 * The world draws this prop 34 pixels wide on the floor. The comment that
 * justifies its existence in `vocabulary.ts` says it "frames a real plotted
 * curve the learner reads off, so it must stay crisp at any zoom" — which only
 * became true the moment there was somewhere to show it large. This is that
 * somewhere: the same points from `chartFrameArt.ts`, emitted as vectors so they
 * scale without a single blurred pixel.
 *
 * It is deliberately the *same* picture as the one on the floor. If it drifted,
 * the prop the learner walked past and the illustration they read would be two
 * different claims about the same content.
 */

import { CHART_BOX, CHART_COLOURS, CHART_FRAME_ALT, chartAxisPoints, chartCurvePoints, chartPolyline } from './chartFrameArt'

export interface ChartFrameProps {
  /**
   * Stroke weights, in the box's own units — 1 unit is one source pixel of the
   * 34x26 prop. Left thinner than the canvas's 1px so a curve blown up eight
   * times reads as a line rather than as a bar.
   */
  weight?: number
  /** Extra classes for the `<svg>`. It fills its container by default. */
  className?: string
}

/** The frame, the two axes and the two curves. No labels: see the note below. */
export function ChartFrame({ weight = 0.7, className }: ChartFrameProps) {
  const axis = chartAxisPoints()

  return (
    <svg
      viewBox={`0 0 ${CHART_BOX.w} ${CHART_BOX.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={CHART_FRAME_ALT}
      className={`h-full w-full ${className ?? ''}`}
      style={{ filter: 'drop-shadow(0 0 6px rgba(67, 217, 196, 0.22))' }}
    >
      <rect x={0} y={0} width={CHART_BOX.w} height={CHART_BOX.h} fill={CHART_COLOURS.panel} />
      <rect
        x={0.5}
        y={0.5}
        width={CHART_BOX.w - 1}
        height={CHART_BOX.h - 1}
        fill="none"
        stroke={CHART_COLOURS.border}
        strokeWidth={weight * 0.7}
      />
      <polyline
        points={chartPolyline(axis)}
        fill="none"
        stroke={CHART_COLOURS.axis}
        strokeWidth={weight * 0.6}
      />
      {/*
        Training first, validation over it, matching the canvas's paint order —
        where the two curves overlap on the left the same one is on top.
        No axis labels and no legend: the same drawing stands in for every scene
        that declares the prop, so anything written on it would be a claim about
        content this component has never seen.
      */}
      {(['training', 'validation'] as const).map((series) => (
        <polyline
          key={series}
          points={chartPolyline(chartCurvePoints(series))}
          fill="none"
          stroke={CHART_COLOURS[series]}
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
