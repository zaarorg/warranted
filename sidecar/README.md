## Governance Sidecar Setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

### Quick start

```bash
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### Run the sidecar

```bash
python scripts/register_openclaw_agent.py
```

### Without a venv

```bash
uv pip install --python 3.12 -r requirements.txt
```