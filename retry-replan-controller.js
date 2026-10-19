import { createContract, mandatoryCriteria } from './dod-contract.js';

const transitions = Object.freeze({ PLAN: ['BUILD', 'ESCALATE'], BUILD: ['VERIFY', 'ESCALATE'], VERIFY: ['FINISH', 'REPLAN', 'RETRY', 'ESCALATE'], REPLAN: ['RETRY', 'ESCALATE'], RETRY: ['BUILD', 'ESCALATE'], ESCALATE: [], FINISH: [] });

/** Create a deterministic bounded controller. Each transition consumes one step;
 * entering RETRY consumes one retry. Bound exhaustion escalates rather than finishes.
 * FINISH requires a contract and a caller-supplied independent verification receipt:
 * {verified:true,recorded:true,current:true,criteria:[{criterionId,passed:true,evidenceId}] }.
 * The caller MUST derive this receipt from current recorded verifier evidence, never model text.
 * @param {{contract?:object,maxRetries?:number,maxSteps?:number,timeoutMs?:number,now?:()=>number}} options
 * @returns {{snapshot:Function,transition:Function,allowedTransitions:Function}}
 */
export function createController({ contract, maxRetries = 3, maxSteps = 20, timeoutMs = 300000, now = Date.now } = {}) {
  for (const [name, value] of Object.entries({ maxRetries, maxSteps })) {
    if (!Number.isSafeInteger(value) || value < (name === 'maxSteps' ? 1 : 0)) throw new TypeError(`${name} must be a bounded integer`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof now !== 'function') throw new TypeError('A positive timeout and clock function are required');
  const validatedContract = contract ? createContract(contract) : null;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new TypeError('Clock must return finite milliseconds');
  let state = 'PLAN', retries = 0, steps = 0, reason = null, lastTime = startedAt;
  const snapshot = () => Object.freeze({ state, retries, steps, reason, startedAt });
  const escalate = why => { state = 'ESCALATE'; reason = why; return snapshot(); };
  return Object.freeze({
    /** Read immutable current state. */
    snapshot,
    /** List legal next states before checking run bounds. */
    allowedTransitions: () => [...transitions[state]],
    /** Advance one state; rejected transitions do not mutate state. Terminal states cannot advance. */
    transition(next, { verification } = {}) {
      if (!transitions[state].includes(next)) throw new Error(`Illegal transition: ${state} → ${next}`);
      const currentTime = now();
      if (!Number.isFinite(currentTime) || currentTime < lastTime) throw new Error('Clock must be finite and monotonic');
      lastTime = currentTime;
      if (currentTime - startedAt >= timeoutMs) return escalate('timeout');
      if (steps >= maxSteps) return escalate('step-limit');
      if (next === 'RETRY' && retries >= maxRetries) return escalate('retry-limit');
      if (next === 'FINISH') {
        if (!validatedContract) throw new Error('FINISH requires a contract');
        if (verification?.verified !== true || verification.recorded !== true || verification.current !== true || !Array.isArray(verification.criteria)) throw new Error('FINISH requires current recorded independent verification');
        const entries = verification.criteria;
        const ids = new Set(entries.map(entry => entry?.criterionId));
        if (ids.size !== entries.length) throw new Error('Duplicate verification criterion');
        for (const id of mandatoryCriteria(validatedContract)) {
          const item = entries.find(entry => entry?.criterionId === id);
          if (!item || item.passed !== true || typeof item.evidenceId !== 'string' || !item.evidenceId.trim()) throw new Error(`Missing passing evidence: ${id}`);
        }
      }
      steps += 1;
      if (next === 'RETRY') retries += 1;
      state = next;
      if (next === 'ESCALATE') reason = 'requested';
      return snapshot();
    },
  });
}
