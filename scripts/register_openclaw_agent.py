# register_openclaw_agent.py
from iatp import TrustSidecar, TrustContext, AgentIdentity
from runtime import Runtime, SessionConfig
from agent_os import StatelessKernel, PolicyEngine, PolicyRule

# Create an identity for your OpenClaw instance
identity = AgentIdentity(
    agent_id="openclaw-agent-001",
    did="did:mesh:openclaw-agent-001",
    owner="your-company",
    parent_authority="did:mesh:admin-user",
)

# Define the trust context (permissions, limits)
trust_ctx = TrustContext(
    agent_id="openclaw-agent-001",
    owner="your-company",
    permissions=["purchase:compute", "purchase:software"],
    spending_limit=5000,
    approved_vendors=["aws", "azure", "gcp"],
    authority_chain=[
        "did:mesh:cfo",
        "did:mesh:vp-eng",
        "did:mesh:openclaw-agent-001"
    ]
)

# Create the governance sidecar
sidecar = TrustSidecar(
    identity=identity,
    trust_context=trust_ctx
)

# Register with the runtime
rt = Runtime()
session = await rt.create_session(
    config=SessionConfig(max_participants=2),
    creator_did="did:mesh:admin-user"
)

# Agent joins and gets assigned a privilege ring
ring = await rt.join_session(
    session.sso.session_id,
    "did:mesh:openclaw-agent-001",
    sigma_raw=0.85
)

print(f"Agent ID: {identity.agent_id}")
print(f"DID: {identity.did}")
print(f"Assigned Ring: {ring}")
print(f"Spending Limit: ${trust_ctx.spending_limit}")
print(f"Approved Vendors: {trust_ctx.approved_vendors}")