/** Localized failure classification without remote diagnostics. */
import type {ControlFailure} from '../control-types.ts'
/** Only sanitized remote categories become native user-facing messages. */
export class PageProblem extends Error{constructor(readonly reason:ControlFailure){super(reason)}}
