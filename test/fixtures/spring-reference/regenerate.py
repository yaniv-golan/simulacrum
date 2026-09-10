"""Optional: python3 regenerate.py; install mpmath==1.3.0 in an isolated environment.

The ordinary test reads frozen decimal samples and requires no Python dependency.
Case parameters live in samples.json, which this script refreshes without changing
its case inventory or comparison policy. Review equation changes independently.
"""
import hashlib
import json
from pathlib import Path
from regularized_tick import Reference, default

base = Path(__file__).parent
path = base / 'samples.json'
data = json.loads(path.read_text())
for case in data['cases']:
    reference = Reference(case['massRatio'], case['precision'], damping=case['damping'])
    samples = []
    for tick in range(1, case['ticks'] + 1):
        sample = reference.step()
        if tick == 1 or tick % 60 == 0:
            samples.append({key: sample[key] for key in ['tick', 'q', 'v']})
    case['samples'] = samples
data['generatorSha256'] = hashlib.sha256((base / 'regularized_tick.py').read_bytes()).hexdigest()
path.write_text(json.dumps(data, default=default, indent=2) + '\n')
