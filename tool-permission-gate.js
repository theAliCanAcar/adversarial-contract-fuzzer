/** Absolute lexical paths only. This is a policy check, not an OS sandbox or symlink resolver. */
function validPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !/[\\%\u0000-\u001f\u007f?#]/u.test(path) && !path.includes('//') && !path.split('/').some(part => part === '.' || part === '..');
}
function canonical(path) { return path === '/' ? '/' : path.replace(/\/$/, ''); }
/** Rules: {tool, operations: ['read'|'write'|...], resources: ['/workspace']}. Default deny. */
export function createToolPermissionGate({ rules = [] } = {}) {
  if (!Array.isArray(rules)) throw new TypeError('Rules must be an array');
  const policy = rules.map(rule => {
    if (!rule || typeof rule.tool !== 'string' || !rule.tool.trim() || !Array.isArray(rule.operations) || !rule.operations.length || rule.operations.some(op => typeof op !== 'string' || !op.trim()) || !Array.isArray(rule.resources) || !rule.resources.length || !rule.resources.every(validPath)) throw new TypeError('Invalid permission rule');
    return { tool: rule.tool, operations: [...rule.operations], resources: rule.resources.map(canonical) };
  });
  const api = {
    check({ tool, resource, operation = 'read' } = {}) {
      if (!validPath(resource)) return { allowed: false, reason: 'Resource must be an absolute path without traversal, encoding, or ambiguous separators' };
      const target = canonical(resource);
      const allowed = policy.some(rule => rule.tool === tool && rule.operations.includes(operation) && rule.resources.some(root => root === '/' || target === root || target.startsWith(`${root}/`)));
      return { allowed, reason: allowed ? 'Matched tool, operation, and resource boundary' : 'No matching permission rule' };
    },
    assert(request) { const result = api.check(request); if (!result.allowed) throw new Error(`Permission denied: ${result.reason}`); return result; },
    async run(request, execute) { api.assert(request); if (typeof execute !== 'function') throw new TypeError('Executor is required'); return execute(Object.freeze({ ...request })); },
  };
  return api;
}
export function demoToolPermissionGate() {
  const gate = createToolPermissionGate({ rules: [{ tool: 'read-file', operations: ['read'], resources: ['/workspace'] }] });
  return ['/workspace/report.json', '/workspace-secrets/key', '/workspace/../secret'].map(resource => ({ resource, ...gate.check({ tool: 'read-file', resource }) }));
}
