/**
 * The refactor's safety net.
 *
 * `chart_frame` was drawn inside `WorldCanvas`'s render effect. Moving it out
 * is only safe if the canvas keeps making exactly the same calls, so the whole
 * pre-refactor function is pasted in below, verbatim, and both versions are run
 * against a context that records every call and every state assignment in
 * order. The two logs must be identical — same operations, same order, same
 * numbers, no rounding drift.
 *
 * Delete this file only together with the canvas's chart prop.
 */

import { describe, expect, it } from 'vitest'

import { CHART_BOX, chartAxisPoints, chartCurvePoints, chartPolyline, drawChartFrame } from './chartFrameArt'

/** One recorded context call: a method with its arguments, or a state assignment. */
type Op = [string, ...unknown[]]

/**
 * A stand-in for the 2D context that keeps a log instead of pixels. Only the
 * calls the chart makes are implemented: anything else must fail loudly rather
 * than be silently dropped from the comparison.
 */
class RecordingContext {
  readonly ops: Op[] = []

  #fillStyle = ''
  #strokeStyle = ''
  #lineWidth = 0

  get fillStyle() {
    return this.#fillStyle
  }
  set fillStyle(value: string) {
    this.#fillStyle = value
    this.ops.push(['fillStyle=', value])
  }

  get strokeStyle() {
    return this.#strokeStyle
  }
  set strokeStyle(value: string) {
    this.#strokeStyle = value
    this.ops.push(['strokeStyle=', value])
  }

  get lineWidth() {
    return this.#lineWidth
  }
  set lineWidth(value: number) {
    this.#lineWidth = value
    this.ops.push(['lineWidth=', value])
  }

  save() {
    this.ops.push(['save'])
  }
  restore() {
    this.ops.push(['restore'])
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.ops.push(['fillRect', x, y, w, h])
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.ops.push(['strokeRect', x, y, w, h])
  }
  beginPath() {
    this.ops.push(['beginPath'])
  }
  moveTo(x: number, y: number) {
    this.ops.push(['moveTo', x, y])
  }
  lineTo(x: number, y: number) {
    this.ops.push(['lineTo', x, y])
  }
  stroke() {
    this.ops.push(['stroke'])
  }
}

/** A recorder, typed as the context the production code expects. */
const recorder = () => {
  const context = new RecordingContext()
  return { context, ctx: context as unknown as CanvasRenderingContext2D }
}

/**
 * `WorldCanvas.drawChartFrame`, exactly as it stood before the extraction —
 * including the local `w`/`h` and the two inline sampling loops. `ctx` was a
 * closure variable there and is a parameter here; nothing else was touched.
 */
function referenceDrawChartFrame(ctx: CanvasRenderingContext2D, centreX: number, footY: number) {
  const w = 34
  const h = 26
  const x = Math.round(centreX - w / 2)
  const y = Math.round(footY - h - 6)

  ctx.save()
  ctx.fillStyle = 'rgba(11, 19, 38, 0.9)'
  ctx.fillRect(x, y, w, h)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(79, 219, 200, 0.75)'
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

  ctx.strokeStyle = 'rgba(218, 226, 253, 0.25)'
  ctx.beginPath()
  ctx.moveTo(x + 4.5, y + 3.5)
  ctx.lineTo(x + 4.5, y + h - 4.5)
  ctx.lineTo(x + w - 3.5, y + h - 4.5)
  ctx.stroke()

  // Training loss: down and to the right, forever.
  ctx.strokeStyle = '#f59e0b'
  ctx.beginPath()
  for (let i = 0; i <= 22; i += 1) {
    const t = i / 22
    const px = x + 5 + t * (w - 9)
    const py = y + 6 + (1 - t) ** 1.6 * (h - 12)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()

  // Validation loss: down, then back up. The gap is the point.
  ctx.strokeStyle = '#4fdbc8'
  ctx.beginPath()
  for (let i = 0; i <= 22; i += 1) {
    const t = i / 22
    const px = x + 5 + t * (w - 9)
    const py = y + 6 + (h - 12) * (0.15 + 3.4 * (t - 0.42) ** 2)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.restore()
}

/** How `WorldCanvas` now places the box. Must stay in step with the wrapper there. */
const placeBox = (centreX: number, footY: number) => ({
  x: Math.round(centreX - CHART_BOX.w / 2),
  y: Math.round(footY - CHART_BOX.h - 6),
})

describe('the canvas draw is unchanged', () => {
  // Whole tiles, half tiles, the bob the canvas applies, and a negative origin
  // for a prop that has scrolled off the left of the camera.
  const placements: Array<[centreX: number, footY: number]> = [
    [0, 0],
    [8, 16],
    [120.5, 64],
    [327, 512.4],
    [-40, -12.75],
    [1000.5, 900.5],
  ]

  it.each(placements)('draws the same ops at (%s, %s)', (centreX, footY) => {
    const expected = recorder()
    referenceDrawChartFrame(expected.ctx, centreX, footY)

    const actual = recorder()
    const { x, y } = placeBox(centreX, footY)
    drawChartFrame(actual.ctx, x, y)

    expect(actual.context.ops).toEqual(expected.context.ops)
  })

  it('records the full sequence, so an identical log is worth something', () => {
    const { context, ctx } = recorder()
    drawChartFrame(ctx, 0, 0)
    const names = context.ops.map(([name]) => name)
    // save, fill, border, axis, two curves, restore.
    expect(names[0]).toBe('save')
    expect(names.at(-1)).toBe('restore')
    expect(names.filter((name) => name === 'beginPath')).toHaveLength(3)
    expect(names.filter((name) => name === 'stroke')).toHaveLength(3)
    // 2 for the axis + 22 for each curve.
    expect(names.filter((name) => name === 'lineTo')).toHaveLength(46)
  })

  it('leaves no state behind for the next prop', () => {
    const { context, ctx } = recorder()
    drawChartFrame(ctx, 4, 4)
    expect(context.ops[0]).toEqual(['save'])
    expect(context.ops.at(-1)).toEqual(['restore'])
  })
})

describe('the geometry the SVG re-plots', () => {
  it('samples both curves across the box', () => {
    for (const series of ['training', 'validation'] as const) {
      const points = chartCurvePoints(series)
      expect(points).toHaveLength(23)
      expect(points[0].x).toBe(5)
      expect(points.at(-1)?.x).toBe(CHART_BOX.w - 4)
    }
  })

  it('falls forever on training and turns back up on validation', () => {
    const training = chartCurvePoints('training')
    // Loss falls, so y decreases the whole way across.
    for (let i = 1; i < training.length; i += 1) {
      expect(training[i].y).toBeLessThan(training[i - 1].y)
    }

    const validation = chartCurvePoints('validation')
    const lowest = validation.reduce((best, point, i) => (point.y < validation[best].y ? i : best), 0)
    // The turn is inside the plot, not at either edge: that bend is the picture.
    expect(lowest).toBeGreaterThan(0)
    expect(lowest).toBeLessThan(validation.length - 1)
    expect(validation.at(-1)!.y).toBeGreaterThan(validation[lowest].y)
  })

  it('draws the axes down the left and along the bottom', () => {
    const [top, corner, right] = chartAxisPoints()
    expect(top.x).toBe(corner.x)
    expect(corner.y).toBe(right.y)
    expect(top.y).toBeLessThan(corner.y)
    expect(right.x).toBeGreaterThan(corner.x)
  })

  it('serialises points for an SVG polyline', () => {
    expect(chartPolyline([{ x: 1, y: 2 }, { x: 3.5, y: 4 }])).toBe('1,2 3.5,4')
  })
})
