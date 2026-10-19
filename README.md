# Adversarial Contract Fuzzer

Seeded adversarial sequences with minimal failing traces.

Standalone ES module. No npm install required. Works in **Node.js 20+** and modern browsers (serve over HTTP for browser demos).

## Included files

This repository vendors local dependencies needed by the module:

- `adversarial-contract-fuzzer.js` (main)
- `retry-replan-controller.js`
- `dod-contract.js`
- `tool-permission-gate.js`
- `requirement-drift-detector.js`

## Install / import

Copy the files into your project, or clone this repository:

```js
import { fuzzController } from './adversarial-contract-fuzzer.js';
// Use case: exercise original controller, permission gate and drift detector against adversarial action sequences.
console.log(fuzzController({ seed: 42, cases: 80, maxSteps: 20 }));
console.log(fuzzController({ seed: 42, cases: 80, maxSteps: 20, mutateFinish: true }));
```

## Use cases

### 1. Find a false-completion controller bug

- **Scenario:** A deliberately broken controller allows FINISH with failing checks.
- **Outcome:** Generate seeded action sequences and return a small reproducible violation trace.

### 2. Exercise transitions beyond the happy path

- **Scenario:** A controller encounters stale evidence, repeated retries, and out-of-order events.
- **Outcome:** Check invariants across bounded reproducible state sequences.

## Exports

- `FUZZ_ACTIONS`
- `createInvariantController`
- `createReliabilityControllerAdapter`
- `replayTrace`
- `fuzzController`

## Notes

- Keep API keys and secrets out of this module and out of browser storage.
- Treat verification callbacks, ledger writers, and permission checks as trusted application code.
- This library is intentional local reliability plumbing, not a claim of cryptographic attestation unless stated in the source comments.

## License

MIT
