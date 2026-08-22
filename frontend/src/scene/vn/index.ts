/**
 * The visual novel: everything a portal is played inside.
 *
 * `VisualNovelShell` is the chassis and the only thing a caller has to mount.
 * The rest are the pieces it slots together, exported because the bodies —
 * reading, answering, explaining — build their own middles out of them.
 *
 *   <VisualNovelShell kind={portal.kind} title={concept.label} xp={xp} onClose={close}
 *     illustration={<SceneIllustration props={scene.props} caption={concept.label} />}
 *     speaker={{ actor: guide }} dialogue={scene.lines[0]}>
 *     <VnChoiceRow kind={portal.kind} choices={choices} selectedId={picked} onSelect={setPicked} />
 *     …the commit button, which is the body's and never the row's…
 *   </VisualNovelShell>
 *
 * Two things to keep in mind when wiring it up:
 *
 *  - the shell leaves the live canvas where it is and puts glass over it, so
 *    nothing here needs the map, the player or anything else that must stay
 *    referentially stable. Pass `backdrop` only to override that, and pass
 *    something stable when you do;
 *  - every string is the caller's. The shell has no copy of its own and will
 *    not fill an empty field.
 */

export { ChartFrame } from './ChartFrame'
export type { ChartFrameProps } from './ChartFrame'

export { SceneIllustration } from './SceneIllustration'
export type { SceneIllustrationProps } from './SceneIllustration'

export { VisualNovelShell } from './VisualNovelShell'
export type { VisualNovelShellProps, VnProgress, VnSpeaker } from './VisualNovelShell'

export { VnChoiceRow } from './VnChoiceRow'
export type { VnChoice, VnChoiceRowProps, VnChoiceTone } from './VnChoiceRow'

export { VnPortrait } from './VnPortrait'
export type { VnPortraitProps } from './VnPortrait'

// The drawn prop, for anyone who needs the curve rather than the component.
export {
  CHART_BOX,
  CHART_COLOURS,
  CHART_FRAME_ALT,
  chartAxisPoints,
  chartCurvePoints,
  chartPolyline,
  drawChartFrame,
} from './chartFrameArt'
export type { ChartPoint, ChartSeries } from './chartFrameArt'

export { ACTOR_DISPLAY_NAMES, actorDisplayName, portraitSheet } from './portrait'
export type { PortraitSheet } from './portrait'
