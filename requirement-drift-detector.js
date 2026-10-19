import { createContract } from './dod-contract.js';

/** Compare immutable task intent against a proposed replacement contract. Deterministic
 * exact-text comparison flags changes for review; it does not claim semantic equivalence.
 * Mandatory removal/demotion, task changes, and removed constraints block replanning.
 * @param {object} original
 * @param {object} proposed
 * @returns {{drifted:boolean,blocked:boolean,changes:object[]}}
 */
export function detectDrift(original, proposed) {
  const before = createContract(original);
  // A proposal may remove every mandatory criterion; inspect that invalid proposal as drift.
  const changes = [];
  if (!proposed || typeof proposed !== 'object') return { drifted: true, blocked: true, changes: [{ type: 'invalid-proposal' }] };
  if (proposed.id !== before.id) changes.push({ type: 'contract-id-changed', blocking: true });
  if (proposed.task !== before.task) changes.push({ type: 'task-changed', blocking: true });
  const criteria = Array.isArray(proposed.criteria) ? proposed.criteria : [];
  for (const item of before.criteria) {
    const replacement = criteria.find(criterion => criterion?.id === item.id);
    if (!replacement) changes.push({ type: 'criterion-removed', criterionId: item.id, blocking: item.mandatory });
    else {
      if (item.description !== replacement.description) changes.push({ type: 'criterion-changed', criterionId: item.id, blocking: item.mandatory });
      if (item.mandatory && replacement.mandatory === false) changes.push({ type: 'criterion-demoted', criterionId: item.id, blocking: true });
      if (!item.mandatory && replacement.mandatory !== false) changes.push({ type: 'criterion-promoted', criterionId: item.id, blocking: false });
    }
  }
  for (const item of criteria) if (!before.criteria.some(criterion => criterion.id === item?.id)) changes.push({ type: 'criterion-added', criterionId: item?.id, blocking: false });
  for (const constraint of before.constraints) if (!Array.isArray(proposed.constraints) || !proposed.constraints.includes(constraint)) changes.push({ type: 'constraint-removed', constraint, blocking: true });
  for (const constraint of Array.isArray(proposed.constraints) ? proposed.constraints : []) if (!before.constraints.includes(constraint)) changes.push({ type: 'constraint-added', constraint, blocking: false });
  try { createContract(proposed); } catch (error) { changes.push({ type: 'invalid-proposal', message: error.message, blocking: true }); }
  return { drifted: changes.length > 0, blocked: changes.some(change => change.blocking), changes };
}
