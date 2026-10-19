import { createController } from './retry-replan-controller.js';
import { createToolPermissionGate } from './tool-permission-gate.js';
import { detectDrift } from './requirement-drift-detector.js';

/** Local stateful testing harness. Generated events are untrusted inputs. Applications
 * must produce check results and permissions from trusted code; this harness does
 * not sandbox tools, authenticate evidence, or certify an arbitrary application.
 */
export const FUZZ_ACTIONS = Object.freeze(['verify-pass', 'verify-fail', 'edit', 'retry', 'unauthorized-call', 'replan-drop', 'report-success', 'finish']);
const bounded = (n, low, high, label) => { if (!Number.isInteger(n) || n < low || n > high) throw new TypeError(`${label} must be ${low}..${high}`); };

/** Reference controller; mutateFinish deliberately removes its completion gate. */
export function createInvariantController({ maxRetries = 3, mutateFinish = false } = {}) {
  bounded(maxRetries, 0, 100, 'maxRetries');
  if (typeof mutateFinish !== 'boolean') throw new TypeError('mutateFinish must be boolean');
  let state = { revision: 1, verifiedRevision: null, passed: false, retries: 0, mandatory: ['acceptance'], unauthorizedExecuted: false, finished: false, escalated: false };
  return { snapshot: () => structuredClone(state), step(action) {
    if (!FUZZ_ACTIONS.includes(action)) throw new TypeError('Unknown fuzz action');
    if (state.finished || state.escalated) return this.snapshot();
    if (action === 'verify-pass') { state.passed = true; state.verifiedRevision = state.revision; }
    if (action === 'verify-fail') { state.passed = false; state.verifiedRevision = state.revision; }
    if (action === 'edit') state.revision++;
    if (action === 'retry') { if (state.retries >= maxRetries) state.escalated = true; else state.retries++; }
    // Unauthorized execution and mandatory-criterion removal are deliberately rejected.
    if (action === 'finish' && (mutateFinish || (state.passed && state.verifiedRevision === state.revision))) state.finished = true;
    return this.snapshot();
  } };
}
/** Adapter for the original production controller, permission gate and drift detector.
 * Test actions model trusted local verifier outcomes; model self-reports cannot set
 * those flags. mutateFinish is an explicitly unsafe wrapper mutation, not a change
 * to the original controller. External applications must authenticate their own checks.
 */
export function createReliabilityControllerAdapter({ maxRetries = 3, mutateFinish = false } = {}) {
  bounded(maxRetries, 0, 100, 'maxRetries');
  if (typeof mutateFinish !== 'boolean') throw new TypeError('mutateFinish must be boolean');
  const contract = { id: 'fuzz-task', task: 'Return a verified answer', criteria: [{ id: 'acceptance', description: 'Answer equals 42', mandatory: true }], constraints: ['No unauthorized tools'] };
  const controller = createController({ contract, maxRetries, maxSteps: 1000, now: () => 0 });
  const gate = createToolPermissionGate({ rules: [{ tool: 'read-file', operations: ['read'], resources: ['/workspace'] }] });
  const transitions = [], rejections = [];
  let revision = 1, verifiedRevision = null, passed = false, unauthorizedExecuted = false, mutatedFinished = false, driftRejections = 0, permissionRejections = 0;
  const transition = (next, options) => { const result = controller.transition(next, options); transitions.push(result.state); return result; };
  transition('BUILD'); transition('VERIFY');
  const snapshot = () => {
    const original = controller.snapshot();
    return { revision, verifiedRevision, passed, retries: original.retries, mandatory: contract.criteria.map(c => c.id), unauthorizedExecuted, finished: mutatedFinished || original.state === 'FINISH', escalated: original.state === 'ESCALATE', controllerState: original.state, controllerTransitions: [...transitions], completionRejections: [...rejections], driftRejections, permissionRejections, implementation: 'original retry-replan-controller + permission gate + drift detector', mutation: mutateFinish ? 'unsafe wrapper FINISH bypass' : null };
  };
  return { snapshot, step(action) {
    if (!FUZZ_ACTIONS.includes(action)) throw new TypeError('Unknown fuzz action');
    if (snapshot().finished || snapshot().escalated) return snapshot();
    if (action === 'verify-pass' || action === 'verify-fail') {
      // A trusted test double reads a concrete local output, independent of claims.
      const localOutput = action === 'verify-pass' ? 42 : 0;
      passed = localOutput === 42; verifiedRevision = revision;
    }
    if (action === 'edit') revision++;
    if (action === 'retry') {
      const retried = transition('RETRY');
      if (retried.state === 'RETRY') { transition('BUILD'); transition('VERIFY'); }
    }
    if (action === 'unauthorized-call') {
      const permission = gate.check({ tool: 'write-file', resource: '/secrets/key', operation: 'write' });
      if (permission.allowed) unauthorizedExecuted = true; else permissionRejections++;
    }
    if (action === 'replan-drop') {
      const proposed = { ...contract, criteria: [] };
      const drift = detectDrift(contract, proposed);
      if (drift.blocked) driftRejections++;
      else contract.criteria = proposed.criteria;
    }
    if (action === 'finish') {
      if (mutateFinish) mutatedFinished = true;
      else {
        try {
          transition('FINISH', { verification: { verified: passed, recorded: verifiedRevision !== null, current: verifiedRevision === revision, criteria: [{ criterionId: 'acceptance', passed, evidenceId: 'trusted-local-check' }] } });
        } catch (error) { rejections.push(error.message); }
      }
    }
    // report-success is untrusted builder text and deliberately cannot certify output.
    return snapshot();
  } };
}
function violation(state, maxRetries) {
  if (state.finished && !state.passed) return 'finish-without-passing-check';
  if (state.finished && state.verifiedRevision !== state.revision) return 'stale-evidence';
  if (state.retries > maxRetries) return 'retry-limit-exceeded';
  if (state.unauthorizedExecuted) return 'unauthorized-action-executed';
  if (!state.mandatory?.includes('acceptance')) return 'mandatory-criterion-lost';
  return null;
}
export function replayTrace(trace, { maxRetries = 3, mutateFinish = false, controllerFactory = createReliabilityControllerAdapter } = {}) {
  if (!Array.isArray(trace) || trace.length > 2000) throw new TypeError('trace must be an array with at most 2000 actions');
  bounded(maxRetries, 0, 100, 'maxRetries');
  const controller = controllerFactory({ maxRetries, mutateFinish });
  let index = 0;
  for (const action of trace) {
    const state = controller.step(action);
    const broken = violation(state, maxRetries);
    if (broken) return { violation: broken, index, state, trace: trace.slice(0, index + 1) };
    index++;
  }
  return { violation: null, state: controller.snapshot(), trace: [...trace] };
}
function minimize(trace, options) {
  let minimal = [...trace], changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < minimal.length; i++) {
      const candidate = minimal.filter((_, index) => index !== i);
      if (replayTrace(candidate, options).violation) { minimal = candidate; changed = true; break; }
    }
  }
  return minimal;
}
/** Seeded generation, followed by deletion shrinking to a 1-minimal failing trace.
 * Completeness is limited to this bounded action model and seed, not all behavior.
 */
export function fuzzController({ seed = 42, cases = 80, maxSteps = 20, maxRetries = 3, mutateFinish = false, controllerFactory = createReliabilityControllerAdapter } = {}) {
  bounded(seed, 0, 4294967295, 'seed'); bounded(cases, 1, 1000, 'cases'); bounded(maxSteps, 1, 100, 'maxSteps'); bounded(maxRetries, 0, 100, 'maxRetries');
  let randomState = seed >>> 0;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  const options = { maxRetries, mutateFinish, controllerFactory };
  const failures = [], coverage = new Set(), applicationTransitions = new Set();
  let permissionRejections = 0, driftRejections = 0, completionRejections = 0;
  for (let index = 0; index < cases; index++) {
    const trace = Array.from({ length: maxSteps }, () => FUZZ_ACTIONS[Math.floor(random() * FUZZ_ACTIONS.length)]);
    trace.forEach(action => coverage.add(action));
    const result = replayTrace(trace, options);
    for (const state of result.state.controllerTransitions ?? []) applicationTransitions.add(state);
    permissionRejections += result.state.permissionRejections ?? 0;
    driftRejections += result.state.driftRejections ?? 0;
    completionRejections += result.state.completionRejections?.length ?? 0;
    if (result.violation) { const minimalTrace = minimize(result.trace, options); failures.push({ case: index, violation: replayTrace(minimalTrace, options).violation, originalTrace: result.trace, minimalTrace }); }
  }
  return { seed, cases, maxSteps, passed: failures.length === 0, failures, actionsCovered: [...coverage].sort(), applicationTransitions: [...applicationTransitions], integrationMetrics: { permissionRejections, driftRejections, completionRejections }, controllerImplementation: controllerFactory === createReliabilityControllerAdapter ? 'original libraries via createReliabilityControllerAdapter' : 'caller-supplied controller factory', trustBoundary: 'Local reference controller and injected test doubles; application evidence and permissions must come from trusted adapters.', shrinkGuarantee: '1-minimal under single-action deletion, not globally shortest' };
}
