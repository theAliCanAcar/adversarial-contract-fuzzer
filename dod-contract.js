/** Definition-of-done contracts. Inference may suggest criteria; code validates them. */
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
  return value.trim();
};

/** Create an immutable contract with unique criteria; criteria default to mandatory.
 * @param {{id:string,task:string,criteria:Array<{id:string,description:string,mandatory?:boolean}>,constraints?:string[]}} input
 * @returns {Readonly<object>} Validated contract, safe to pass to a planner.
 */
export function createContract({ id, task, criteria, constraints = [] } = {}) {
  if (!Array.isArray(criteria) || !criteria.length) throw new TypeError('At least one criterion is required');
  if (!Array.isArray(constraints)) throw new TypeError('constraints must be an array');
  const ids = new Set();
  const normalized = criteria.map(criterion => {
    const criterionId = text(criterion?.id, 'criterion.id');
    if (ids.has(criterionId)) throw new Error(`Duplicate criterion: ${criterionId}`);
    ids.add(criterionId);
    if (criterion.mandatory !== undefined && typeof criterion.mandatory !== 'boolean') throw new TypeError('mandatory must be boolean');
    return Object.freeze({ id: criterionId, description: text(criterion.description, 'criterion.description'), mandatory: criterion.mandatory ?? true });
  });
  if (!normalized.some(criterion => criterion.mandatory)) throw new Error('At least one mandatory criterion is required');
  return Object.freeze({ id: text(id, 'id'), task: text(task, 'task'), criteria: Object.freeze(normalized), constraints: Object.freeze(constraints.map(item => text(item, 'constraint'))) });
}

/** List mandatory criterion IDs without exposing mutable contract internals. */
export function mandatoryCriteria(contract) {
  return contract.criteria.filter(criterion => criterion.mandatory).map(criterion => criterion.id);
}
