#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_db="moventra_test_worker_$(date +%s)_${RANDOM}"
task_dir=$(mktemp -d /tmp/moventra-worker.XXXXXX)
task_created=false
cleanup() {
  if "$task_created"; then dropdb -h /tmp "$task_db"; fi
  rm -rf "$task_dir"
}
trap cleanup EXIT
createdb -h /tmp "$task_db"
task_created=true
export DATABASE_URL="postgresql:///${task_db}?host=/tmp"
export LEDGER_MODE=shadow BLNK_NAMESPACE=shadow_runtime BLNK_LEDGER_ID=general_ledger_id
# No Blnk request is needed for an empty queue or its status query.
export BLNK_URL=http://127.0.0.1:1 BLNK_API_KEY=synthetic-local-runtime-only DB_MAX_CONNS=2
go run ./cmd/api migrate
go build -o "$task_dir/worker" ./cmd/worker
go build -o "$task_dir/ledger" ./cmd/ledger
python3 - "$task_dir" <<'PY'
import json, pathlib, selectors, signal, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
result = subprocess.run([str(root / 'ledger'), 'status'], check=True, capture_output=True, text=True, timeout=10)
status = json.loads(result.stdout)
assert status['due'] == 0 and status['oldestDueSeconds'] is None, status
process = subprocess.Popen([str(root / 'worker')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    pending = b''
    found = False
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and not found:
        for key, _ in selector.select(timeout=0.2):
            import os
            chunk = os.read(key.fd, 65536)
            if not chunk:
                raise AssertionError('worker exited before queue observation')
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                event = json.loads(line)
                if event.get('event') == 'ledger_queue':
                    assert event['queue']['due'] == 0 and event['pool_max'] == 2, event
                    assert 'synthetic-local-runtime-only' not in line.decode()
                    found = True
    assert found, 'no structured queue observation'
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=5) == 0, 'unclean worker shutdown'
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
print('PASS: local status CLI, JSON worker observation, configured pool and SIGTERM shutdown')
PY
