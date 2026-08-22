/**
 * `chart_frame`, in one place.
 *
 * It is the only entry in `PROPS` that is not a sprite: per `vocabulary.ts` it
 * "frames a real plotted curve the learner reads off, so it must stay crisp at
 * any zoom", which is why it is drawn rather than blitted. That drawing used to
 * live inside `WorldCanvas`'s render effect, where nothing else could reach it —
 * so the one prop with something to say was locked inside a 34x26 box on a
 * canvas that never had a scene to put it on.
 *
 * This module is that drawing, lifted out unchanged and split in two:
 *
 *  - the **geometry** (`chartAxisPoints`, `chartCurvePoints`) — pure points in
 *    the prop's own 34x26 pixel box, offset by an origin the caller supplies;
 *  - the **canvas draw** (`drawChartFrame`) — the same sequence of context calls
 *    `WorldCanvas` always made, in the same order, with the same numbers.
 *
 * `WorldCanvas` calls the second and is byte-identical (`chartFrameArt.test.ts`
 * proves it against a copy of the original code); `vn/ChartFrame.tsx` reads the
 * first and re-plots the same curve as an SVG at poster size.
 *
 * Nothing here is generated content. The curve is a fixed illustration owned by
 * the client, exactly like the sprite behind every other prop — the generator
 * only ever chose the *name* `chart_frame` from a closed enum.
 */

/** The prop's own box, in source pixels. Every point below is relative to it. */
export const CHART_BOX = { w: 34, h: 26 } as const

/**
 * The palette, read off the original draw. Amber is the app's primary and teal
 * its secondary, so the two curves already read as two different things before
 * anyone works out which is which.
 */
export const CHART_COLOURS = {
  panel: 'rgba(11, 19, 38, 0.9)',
  border: 'rgba(79, 219, 200, 0.75)',
  axis: 'rgba(218, 226, 253, 0.25)',
  /** Down and to the right, forever. */
  training: '#f59e0b',
  /** Down, then back up. The gap between the two is the point. */
  validation: '#4fdbc8',
} as const

export type ChartSeries = 'training' | 'validation'

/** How many segments each curve is drawn with. Straight from the original loop. */
const SAMPLES = 22

export interface ChartPoint {
  x: number
  y: number
}

/**
 * The two axes: down the left, then along the bottom.
 *
 * `x`/`y` are added in the same order the original expressions used, so passing
 * an origin reproduces its arithmetic exactly rather than merely closely.
 */
export const chartAxisPoints = (x = 0, y = 0): ChartPoint[] => [
  { x: x + 4.5, y: y + 3.5 },
  { x: x + 4.5, y: y + CHART_BOX.h - 4.5 },
  { x: x + CHART_BOX.w - 3.5, y: y + CHART_BOX.h - 4.5 },
]

/** One curve, sampled left to right. Same caveat about arithmetic order. */
export function chartCurvePoints(series: ChartSeries, x = 0, y = 0): ChartPoint[] {
  const w = CHART_BOX.w
  const h = CHART_BOX.h
  const points: ChartPoint[] = []
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = i / SAMPLES
    const px = x + 5 + t * (w - 9)
    const py =
      series === 'training'
        ? y + 6 + (1 - t) ** 1.6 * (h - 12)
        : y + 6 + (h - 12) * (0.15 + 3.4 * (t - 0.42) ** 2)
    points.push({ x: px, y: py })
  }
  return points
}

/** `points` in the form an SVG `<polyline>` wants. */
export const chartPolyline = (points: readonly ChartPoint[]): string =>
  points.map((point) => `${point.x},${point.y}`).join(' ')

/**
 * What the picture shows, in words, for anyone who cannot see it.
 *
 * Deliberately a description of the *drawing* and not of any course: the same
 * curve is drawn for every scene that declares the prop, so it may not claim to
 * be about whatever that scene happens to teach.
 */
export const CHART_FRAME_ALT =
  'A small plotted chart: one curve falls and keeps falling, a second falls with it and then turns back up.'

/**
 * The prop, drawn onto a 2D context with its box's top-left corner at `x`,`y`.
 *
 * Lifted verbatim out of `WorldCanvas`: same calls, same order, same literals.
 * It saves and restores the context, so the caller's fill and stroke state
 * survive it.
 */
export function drawChartFrame(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = CHART_BOX.w
  const h = CHART_BOX.h

  ctx.save()
  ctx.fillStyle = CHART_COLOURS.panel
  ctx.fillRect(x, y, w, h)
  ctx.lineWidth = 1
  ctx.strokeStyle = CHART_COLOURS.border
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

  ctx.strokeStyle = CHART_COLOURS.axis
  ctx.beginPath()
  const axis = chartAxisPoints(x, y)
  ctx.moveTo(axis[0].x, axis[0].y)
  ctx.lineTo(axis[1].x, axis[1].y)
  ctx.lineTo(axis[2].x, axis[2].y)
  ctx.stroke()

  // Training loss: down and to the right, forever.
  // Validation loss: down, then back up. The gap is the point.
  for (const series of ['training', 'validation'] as const) {
    ctx.strokeStyle = CHART_COLOURS[series]
    ctx.beginPath()
    chartCurvePoints(series, x, y).forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
  }
  ctx.restore()
}
