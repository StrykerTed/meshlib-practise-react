# meshlib-docker-compiler — ⚠️ name/content mismatch

Path: `/Users/ted.tedford/Public/MyLocalRepos/meshlib-docker-compiler`

## TL;DR

The repo's name implies it compiles meshlib (C++ → WASM/native) in a container.
**It does not.** Its three files describe the Syklone **`prd-svc-case-manager`**
Python web service. There is **no** Emscripten, CMake, C++, or meshlib content.
This looks like leftover/misplaced files. Flagged for a team decision.

## What's actually in it

Only three files:

### `Dockerfile`
- Base: `syklonedevelop.azurecr.io/pythonbaseimage:3.11` (Syklone private Python image).
- Builds the `prd-svc-case-manager` app: creates a non-root `python` user, copies the project + a `pkg_message_broker_azure_service_bus/` dependency, `pip install -r requirements.txt` (custom Azure index), `python setup.py install`, exposes `5000`.
- Runtime: gunicorn with 4 uvicorn workers serving `prd_svc_case_manager.main:app`.
- Confirmed first line: `FROM syklonedevelop.azurecr.io/pythonbaseimage:3.11`.

### `Dockerfile.fp`
- Dev variant. Base `python:3.11`, `apt upgrade`, a venv at `/opt/venv`, installs `pudb` (debugger), `ARG TARGET_APP`, editable install (`-e .`), runs `uvicorn --reload` with a single worker and `--log-level debug`.
- The `.fp` suffix appears to mean a fast/dev "footprint" build, not anything meshlib-related.

### `docker-compose.yml`
Orchestrates the case-manager stack — none of it meshlib:
- **mongodb** (`mongo`, :27017, db `case-manager`)
- **rabbitmq** (`rabbitmq:3-management`, :5672 / :8085, guest/guest, vhost `rabbitmqv-host`)
- **azurite** (Azure Storage emulator, :10000 blob / :10001 queue)
- **prd-svc-case-manager** (builds `./`, image `prd-svc-case-manager:local-latest`, :5555→:5000, Mongo connection string, `env_file: ./.env.local`, `depends_on: mongodb`)

This is the same service stack that the unrelated
`SykloneAll/.../prd-svc-case-manager` working folder targets.

## Why this matters

If you're looking for "the thing that compiles meshlib in Docker," it is **not
here.** Based on `meshlib/web/ADDING_NEW_TOOLS.md`, the real containerized build
of meshlib's Linux `.so` lives in a separate repo, **`meshlib-python-testing`**,
via `scripts/build_native_lib.sh` (a `gcc:14` Docker container that installs
CMake + Eigen and builds the `*_native` targets). See
[03-wasm-pipeline.md](03-wasm-pipeline.md). The WASM build itself is done
locally with `emcmake` (no container required) — see
[01-meshlib-cpp.md](01-meshlib-cpp.md).

## Suggested follow-up (team decision)

1. **Confirm intent.** Was this repo meant to host a reproducible meshlib WASM/native
   build, or was the name aspirational and the content pasted from case-manager?
2. **Then either**
   - **Repurpose** it: replace the contents with an Emscripten-based image (e.g.
     `emscripten/emsdk`) that configures + builds the `web/wasm_*` targets and
     emits `meshlib_<tool>.js/.wasm` as artifacts — closing the "manual copy" gap
     noted in the pipeline doc; **or**
   - **Remove / rename** it to avoid confusion, and document `meshlib-python-testing`
     as the canonical native-build container instead.

> Note: the file currently open in the IDE
> (`meshlib-docker-compiler/docker-compose.yml`) is the case-manager compose file
> described above — not a meshlib build file.
