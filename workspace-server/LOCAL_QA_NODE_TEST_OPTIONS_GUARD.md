# Node/npm inherited test-filter integrity — Workspace offline QA

**2026-11-05 · Security QA source-only draft.** This is a local test attestation guard, not an active native login, paid-seat or production change.

## Demonstrated false-green condition

The existing Workspace `qa:local` runner correctly checks its canonical parent Git repository, tracked index flags/modes, clean HEAD and pre/post source identity. However, it inherited arbitrary Node/npm environment variables into `npm run check`, `npm test` and `node --test`.

In an isolated **real Node.js 22.16** test with a deliberately failing assertion:

- `node --test sample.test.mjs`: **exit code 1**, test fails as expected.
- `NODE_OPTIONS='--test-name-pattern=not-a-test' node --test sample.test.mjs`: **exit code 0**, with `1..0` inside the TAP output: no actual named security tests ran, although the outer file runner reports one passing file.
- `npm_config_node_options='--test-name-pattern=not-a-test' npm test`: also **exit code 0** on the same failing fixture.
- A custom `npm_config_script_shell` can also return success without invoking the test command. A separate isolated Unix npm fixture reproduced exit code 0 despite a deliberately failing security test.

An exact Git commit alone cannot protect against test suppression injected by the local Node/npm process environment. The result could be labeled green despite failing native/tenant/security tests.

## Implemented fail-closed guard

`scripts/local-qa.mjs` now:

1. Rejects any **nonempty inherited** `NODE_OPTIONS`, `NODE_PATH`, `npm_config_node_options` or `npm_config_script_shell` (including uppercase/lowercase aliases), before executing any `npm` or browser test stage.
2. Also removes those Node/npm overrides and all `GIT_*` overrides from **every spawned child** (including `npm`, `node` and `git`) to prevent module preloads, inherited Node test-name filters and alternate Git worktree/index selection.
3. Does not permit `--allow-dirty` to bypass the environment check. An operator must run from a clean, authorized environment and can then obtain meaningful exact-head attestation.

The regression source `tests/local-qa-runner.test.mjs` covers environment detection, denial before QA execution, and a real disposable failing Node test that turns exit 0 when test names are excluded. This preserves existing Node22/24 and Chromium QA stages and the entire prior Git index/symlink/parent-policy protection.

## Verification and boundary

The **isolated actual Node22 and npm test-filter bypass was reproduced** (original assertion fails without injection, is excluded and returns success with injected filter). The **new full Workspace local QA and Chromium regression suite has not yet run on this draft**: the complete private checkout is not available to this runtime and hosted GitHub Actions capacity has been exhausted. Do not report this as a passed exact-head test or native system validation.

This prevents accidental/malicious inherited test suppression, but a host that can arbitrarily replace Node/npm executables or modify the running QA process cannot be attested by code in that same untrusted environment. The staging operator must additionally use pinned, trusted toolchains and a controlled runner.

No secrets, Stripe payments, native permissions, client grants, DNS, deployment or merges were performed.

## Important entrypoint limitation: npm wrapper vs. direct Node invocation

The environment guard executes **inside** `scripts/local-qa.mjs`. A system with a deliberately altered npm script shell could prevent `npm run qa:local` from launching that script at all. A zero exit code from the **npm wrapper alone** is therefore not sufficient release evidence.

For the real release-acceptance gate, the operator must launch the source-pinned program **directly**, from the canonical `workspace-server` directory, using a trusted Node executable:

```sh
node scripts/local-qa.mjs --expect-head=<verified-40-hex-head> --json
node scripts/local-qa.mjs --browser --expect-head=<verified-40-hex-head> --json
```

Review the actual JSON report from the runner, including `exactHead:true`, every test stage `passed`, and the expected SHA, rather than relying only on shell exit code. The tool must refuse an inherited custom npm script shell. `npm run qa:local` remains a developer convenience but **must not** be presented as a fully attested release gate in an untrusted npm environment.

The direct Node runner still invokes `npm run check` and `npm test` internally, using cleaned child environment. A malicious global npm configuration or compromised local executable is outside the guarantees of an application-level guard; require a controlled, reviewed operator machine.
