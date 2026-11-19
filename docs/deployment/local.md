# Local development

SEM Lab is a static web application: modeling, data, estimation and reporting run in the
browser. There is no server to start.

```bash
npm ci
npm run dev            # http://localhost:5173
```

Quality gates (CI runs the same commands):

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build
npm run e2e --workspace @sem-lab/web        # browser tests in the installed Google Chrome
```

## Verification oracle (optional, for developers)

The browser engine is verified against reference results produced by R. They are committed in
`packages/fixtures/reference-results/`, so ordinary development and CI do not need R. To
regenerate them or run the R-backed tests:

```bash
services/r-engine/bin/rscript services/r-engine/scripts/install_packages.R   # once; compiles cSEM, lavaan, …
services/r-engine/bin/test                                                    # R engine reference tests
python3 packages/fixtures/scripts/make_pls_references.py                      # PLS references
services/r-engine/bin/rscript packages/fixtures/scripts/make_cb_references.R   # CB-SEM references
```

With R installed, the web tests also run the exported R scripts and compare them with the
browser engine (`apps/web/src/features/code-export/*.test.ts`); without R those tests skip.

## Python engine (exports and notebooks)

```bash
cd packages/python-engine && uv run pytest
```
