'use strict'
// The authorization policy — ONE place that answers "may this user do that?".
//
// ✅ Three roles was the right granularity and stays (C5). The defect was never
// the role model: it was that authorization existed only as inline string
// comparisons (`if (user.role !== 'admin')`) scattered across route handlers,
// with no single place to READ the policy and nothing that could TEST it. Nine
// sites, nine chances for one to be forgotten on the next route, and no way to
// answer "what can a guest do?" except by grepping.
//
// So the rule is: a route never compares a role. It names an ACTION, and this
// module decides. Adding a route means naming its action here — which is a
// deliberate speed bump in exactly the place where a silent omission is a hole.
// `pnpm test:contracts` runs a scan (test/policy.mjs) asserting no route file
// re-types a role comparison, so the speed bump cannot be walked around.

const ROLES = Object.freeze(['guest', 'user', 'admin'])

// Every action the service gates, with the roles that hold it. One table, so
// "what can a guest do?" is a question you answer by reading rather than by
// grepping — which is the whole point of extracting this.
//
// Note what ISN'T here: ownership. "May I read MY events" is not a role question
// — every signed-in user may, and the scoping happens in the query (WHERE
// user_id = me). Roles answer "which KIND of thing", ownership answers "whose".
// Conflating them is how you get a policy that says `admin` where it means `mine`.
const ACTIONS = Object.freeze({
  // Suite administration — a change that reaches every user's screen.
  'widgets:publish':    ['admin'],
  'widgets:delete':     ['admin'],
  // The nginx admin gate in front of staging.
  'staging:enter':      ['admin'],
  // Read the whole suite's audit trail rather than only your own rows.
  'events:read:all':    ['admin'],
  // Self-service on your own account. Guests are excluded deliberately: the
  // guest row is a SHARED credential, so "change the password" or "sign out my
  // other devices" would be one visitor acting on every other visitor.
  'account:manage':     ['user', 'admin'],
  // Ask for a password-reset code. Same reasoning — a shared account's password
  // is the operator's to rotate, via GUEST_PASSWORD, not a visitor's.
  'password:reset':     ['user', 'admin'],
})

/** Does this role hold this action? Unknown action → false, loudly.
 *
 *  Fail CLOSED on an unknown name: a typo'd action must deny rather than sail
 *  through, because the failure mode of the alternative is an unguarded route
 *  that looks guarded at the call site. */
function roleCan(role, action) {
  const allowed = ACTIONS[action]
  if (!allowed) {
    console.error(`[policy] unknown action ${JSON.stringify(action)} — denying. Add it to ACTIONS in src/policy.js.`)
    return false
  }
  return allowed.includes(role)
}

const can = (user, action) => !!user && roleCan(user.role, action)

/** Express guard: `router.post(path, require('...').requires('widgets:publish'), handler)`.
 *  Answers 401 when there is no identity and 403 when there is one without the
 *  action — the distinction a caller needs to know whether to re-authenticate. */
function requires(action, resolveUser) {
  return function policyGuard(req, res, next) {
    const user = req.user ?? (resolveUser ? resolveUser(req) : null)
    if (!user) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
    if (!can(user, action)) return res.status(403).json({ error: 'Not permitted', code: 'FORBIDDEN', action })
    req.user = user
    next()
  }
}

/** Every action a role holds — the shape a UI uses to decide what to render, so
 *  the screen and the server agree about what is possible instead of each
 *  hard-coding its own idea. */
function actionsFor(role) {
  return Object.keys(ACTIONS).filter(a => roleCan(role, a))
}

module.exports = { ROLES, ACTIONS, can, roleCan, requires, actionsFor }
