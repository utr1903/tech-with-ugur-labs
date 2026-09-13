#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 - "$script_dir" <<'PY'
import pathlib
import sys
source = (pathlib.Path(sys.argv[1]) / 'network-smoke.sh').read_text()
start = source.index('def validate(records):')
end = source.index('\nvalidate(records)', start)
namespace = {}
exec(source[start:end], namespace)
class Validator:
    validate = staticmethod(namespace['validate'])
module = Validator()
records = [{'received_bytes': len(data := f'GET /{prefix}-{path} HTTP/1.0\r\n\r\n'), 'data': data} for prefix in ('runc-policy-baseline', 'runc-policy-after') for path in ('pod', 'service', 'node')]
module.validate(records)
for payload in ('GET /gvi', 'G', 'GET /runc-policy-baseline-pod HTTP/1.0\r\n\r\nextra'):
    try:
        module.validate(records + [{'received_bytes': len(payload), 'data': payload}])
    except AssertionError:
        continue
    raise AssertionError(f'accepted unexpected bytes: {payload!r}')
print('PASS: partial TCP and unexpected payloads rejected')
PY
