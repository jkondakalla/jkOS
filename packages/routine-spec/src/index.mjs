// ESM twin of index.js — so `@jkos/routine-spec` resolves for both `require` (the
// no-bundler Node backend) and `import` (Vite, which cannot name-import a workspace
// CommonJS module). Mirrors the @jkos/weave collection.js/.mjs pattern; check:routine
// asserts the two faces expose the SAME names, so a new export cannot reach one half
// of the suite and not the other — which is exactly the drift a hand-kept mirror had.
import mod from './index.js'

export const SPEC_VERSION = mod.SPEC_VERSION
export const LIMITS = mod.LIMITS
export const MAX_RULES = mod.MAX_RULES
export const UNITS = mod.UNITS
export const LOAD_UNITS = mod.LOAD_UNITS
export const PROGRESSIONS = mod.PROGRESSIONS
export const DRIVES = mod.DRIVES
export const ADVANCE_ON = mod.ADVANCE_ON
export const PHASE_REPEAT = mod.PHASE_REPEAT
export const BLOCKS = mod.BLOCKS
export const COLLECTIONS = mod.COLLECTIONS
export const CADENCES = mod.CADENCES
export const MEASURES = mod.MEASURES
export const WINDOWS = mod.WINDOWS
export const emptySpec = mod.emptySpec
export const normalizeSpec = mod.normalizeSpec
export const validateSpec = mod.validateSpec
export const phaseAt = mod.phaseAt
export const isDeload = mod.isDeload
export const progressionAt = mod.progressionAt
export const applyProgressions = mod.applyProgressions
export const promoteAtCap = mod.promoteAtCap
export const renderStep = mod.renderStep
export const renderCycle = mod.renderCycle
export const parseCadence = mod.parseCadence
export const formatCadence = mod.formatCadence
export const expandCadence = mod.expandCadence
export const describeCadence = mod.describeCadence
export const metricOf = mod.metricOf
export const seriesFor = mod.seriesFor
export const amountOf = mod.amountOf
export const windowStart = mod.windowStart
export const stepLine = mod.stepLine
export const sessionLine = mod.sessionLine
export const summarize = mod.summarize
export const normalizePerformed = mod.normalizePerformed
export const stepWasMet = mod.stepWasMet
export const metFromSets = mod.metFromSets
export const blankSets = mod.blankSets
export const slugify = mod.slugify
export const humanize = mod.humanize
export const roundTo = mod.roundTo
export const isoWeekStart = mod.isoWeekStart
export const shiftDays = mod.shiftDays
export const daysBetween = mod.daysBetween
export const prescriptionOf = mod.prescriptionOf
export const performedOf = mod.performedOf
export const stepStatus = mod.stepStatus
export const logStep = mod.logStep
export const CADENCE_LABEL = mod.CADENCE_LABEL
export const MEASURE_LABEL = mod.MEASURE_LABEL
export const PROGRESSION_LABEL = mod.PROGRESSION_LABEL
export default mod
