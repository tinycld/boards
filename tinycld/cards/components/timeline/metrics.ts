/** Pixel geometry the timeline's axis, rows and scroll maths all share. */
export interface TimelineMetrics {
    dayWidth: number
    rowHeight: number
    labelWidth: number
}

export const DESKTOP_METRICS: TimelineMetrics = { dayWidth: 36, rowHeight: 32, labelWidth: 220 }
export const MOBILE_METRICS: TimelineMetrics = { dayWidth: 28, rowHeight: 30, labelWidth: 120 }

/** Height of the sticky day axis: a month row over a day row. */
export const AXIS_HEIGHT = 40
