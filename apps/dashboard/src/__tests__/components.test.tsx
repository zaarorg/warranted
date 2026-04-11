import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DenyBanner } from "@/components/envelope/DenyBanner";
import { DimensionDisplay } from "@/components/envelope/DimensionDisplay";
import { InheritanceChain } from "@/components/envelope/InheritanceChain";
import { EnvelopeView } from "@/components/envelope/EnvelopeView";
import { CedarSourceViewer } from "@/components/cedar/CedarSourceViewer";
import { PetitionComingSoon } from "@/components/petitions/PetitionComingSoon";
import type { ResolvedDimension, ResolvedEnvelope, DimensionSource } from "@/lib/types";

// ---------------------------------------------------------------------------
// DenyBanner
// ---------------------------------------------------------------------------
describe("DenyBanner", () => {
  it("appears and shows source policy name", () => {
    render(<DenyBanner denySource="sanctioned-vendors" />);
    expect(screen.getByText(/Denied by policy/)).toBeInTheDocument();
    expect(screen.getByText(/sanctioned-vendors/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DimensionDisplay
// ---------------------------------------------------------------------------
describe("DimensionDisplay", () => {
  it("renders numeric kind as max value", () => {
    const dim: ResolvedDimension = {
      name: "amount",
      kind: "numeric",
      resolved: 5000,
      sources: [],
    };
    render(<DimensionDisplay dimension={dim} />);
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("numeric")).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });

  it("renders set kind as chips", () => {
    const dim: ResolvedDimension = {
      name: "vendor",
      kind: "set",
      resolved: ["aws", "gcp"],
      sources: [],
    };
    render(<DimensionDisplay dimension={dim} />);
    expect(screen.getByText("aws")).toBeInTheDocument();
    expect(screen.getByText("gcp")).toBeInTheDocument();
  });

  it("renders boolean kind as badge", () => {
    const dim: ResolvedDimension = {
      name: "requires_approval",
      kind: "boolean",
      resolved: true,
      sources: [],
    };
    render(<DimensionDisplay dimension={dim} />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("renders temporal kind as expiry date", () => {
    const dim: ResolvedDimension = {
      name: "budget_expiry",
      kind: "temporal",
      resolved: "2026-12-31",
      sources: [],
    };
    render(<DimensionDisplay dimension={dim} />);
    expect(screen.getByText(/2026-12-31/)).toBeInTheDocument();
  });

  it("renders rate kind as limit/window", () => {
    const dim: ResolvedDimension = {
      name: "transactions",
      kind: "rate",
      resolved: { limit: 10, window: "1 hour" },
      sources: [],
    };
    render(<DimensionDisplay dimension={dim} />);
    expect(screen.getByText(/10 per 1 hour/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InheritanceChain
// ---------------------------------------------------------------------------
describe("InheritanceChain", () => {
  const sources: DimensionSource[] = [
    { policyName: "org-limit", groupName: "Acme Corp", level: "org", value: 5000 },
    { policyName: "dept-limit", groupName: "Engineering", level: "department", value: 2000 },
    { policyName: "team-limit", groupName: "Platform", level: "team", value: 1000 },
  ];

  it("shows sources in correct order (org -> dept -> team)", async () => {
    render(<InheritanceChain sources={sources} />);
    const toggle = screen.getByText(/Show provenance/);
    fireEvent.click(toggle);
    const items = screen.getAllByText(/org-limit|dept-limit|team-limit/);
    expect(items.length).toBe(3);
    expect(items[0]).toHaveTextContent("org-limit");
    expect(items[1]).toHaveTextContent("dept-limit");
    expect(items[2]).toHaveTextContent("team-limit");
  });

  it("is collapsible", () => {
    render(<InheritanceChain sources={sources} />);
    expect(screen.queryByText("org-limit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show provenance/));
    expect(screen.getByText("org-limit")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Hide provenance/));
    expect(screen.queryByText("org-limit")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// EnvelopeView
// ---------------------------------------------------------------------------
describe("EnvelopeView", () => {
  it("renders resolved dimensions with correct values", () => {
    const envelope: ResolvedEnvelope = {
      agentDid: "did:mesh:test",
      policyVersion: 3,
      resolvedAt: "2026-04-11T10:00:00Z",
      actions: [
        {
          actionId: "a1",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            { name: "amount", kind: "numeric", resolved: 1000, sources: [] },
          ],
        },
      ],
    };
    render(<EnvelopeView envelope={envelope} />);
    expect(screen.getByText("purchase.initiate")).toBeInTheDocument();
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });

  it("shows deny banner when action is denied", () => {
    const envelope: ResolvedEnvelope = {
      agentDid: "did:mesh:test",
      policyVersion: 1,
      resolvedAt: "2026-04-11T10:00:00Z",
      actions: [
        {
          actionId: "a1",
          actionName: "purchase.initiate",
          denied: true,
          denySource: "sanctioned-vendors",
          dimensions: [],
        },
      ],
    };
    render(<EnvelopeView envelope={envelope} />);
    expect(screen.getByText(/Denied by policy/)).toBeInTheDocument();
    expect(screen.getByText(/sanctioned-vendors/)).toBeInTheDocument();
  });

  it("shows provenance chain for each dimension", () => {
    const envelope: ResolvedEnvelope = {
      agentDid: "did:mesh:test",
      policyVersion: 1,
      resolvedAt: "2026-04-11T10:00:00Z",
      actions: [
        {
          actionId: "a1",
          actionName: "purchase.initiate",
          denied: false,
          denySource: null,
          dimensions: [
            {
              name: "amount",
              kind: "numeric",
              resolved: 1000,
              sources: [
                { policyName: "org-limit", groupName: "Acme", level: "org", value: 5000 },
              ],
            },
          ],
        },
      ],
    };
    render(<EnvelopeView envelope={envelope} />);
    expect(screen.getByText(/Show provenance/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CedarSourceViewer
// ---------------------------------------------------------------------------
describe("CedarSourceViewer", () => {
  it("renders Cedar source in pre block", () => {
    render(<CedarSourceViewer source={'permit (\n  principal,\n  action,\n  resource\n);'} />);
    expect(screen.getByText(/permit/)).toBeInTheDocument();
    expect(screen.getByText(/principal/)).toBeInTheDocument();
  });

  it("highlights permit/forbid keywords", () => {
    const { container } = render(<CedarSourceViewer source="permit (principal, action, resource);" />);
    const highlighted = container.querySelectorAll(".text-blue-600, .dark\\:text-blue-400");
    const texts = Array.from(highlighted).map((el) => el.textContent);
    expect(texts).toContain("permit");
    expect(texts).toContain("principal");
    expect(texts).toContain("action");
    expect(texts).toContain("resource");
  });
});

// ---------------------------------------------------------------------------
// PetitionComingSoon
// ---------------------------------------------------------------------------
describe("PetitionComingSoon", () => {
  it("renders coming soon message", () => {
    render(<PetitionComingSoon />);
    expect(screen.getByText("Petitioning")).toBeInTheDocument();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
    expect(screen.getByText(/one-time exception/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PolicyREPL (mock fetch)
// ---------------------------------------------------------------------------
describe("PolicyREPL", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-generates input fields for selected action type", async () => {
    const { PolicyREPL } = await import("@/components/repl/PolicyREPL");
    const actionTypes = [
      {
        id: "at1",
        domain: "finance" as const,
        name: "purchase.initiate",
        description: null,
        dimensions: [
          {
            id: "d1",
            actionTypeId: "at1",
            dimensionName: "amount",
            kind: "numeric" as const,
            numericMax: "5000",
            rateLimit: null,
            rateWindow: null,
            setMembers: null,
            boolDefault: null,
            boolRestrictive: null,
            temporalExpiry: null,
          },
          {
            id: "d2",
            actionTypeId: "at1",
            dimensionName: "vendor",
            kind: "set" as const,
            numericMax: null,
            rateLimit: null,
            rateWindow: null,
            setMembers: ["aws", "gcp"],
            boolDefault: null,
            boolRestrictive: null,
            temporalExpiry: null,
          },
        ],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: actionTypes }),
      }),
    );

    render(<PolicyREPL agentDid="did:mesh:test" />);

    await waitFor(() => {
      expect(screen.getByText(/Select an action type/)).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "purchase.initiate" } });

    await waitFor(() => {
      expect(screen.getByText("amount")).toBeInTheDocument();
      expect(screen.getByText("vendor")).toBeInTheDocument();
    });
  });

  it("shows Allow/Deny result after test", async () => {
    const { PolicyREPL } = await import("@/components/repl/PolicyREPL");

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // action-types call
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: [
                  {
                    id: "at1",
                    domain: "finance",
                    name: "purchase.initiate",
                    description: null,
                    dimensions: [],
                  },
                ],
              }),
          });
        }
        // check call
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                decision: "Allow",
                diagnostics: [],
                engineCode: null,
                sdkCode: null,
                details: {},
              },
            }),
        });
      }),
    );

    render(<PolicyREPL agentDid="did:mesh:test" />);

    await waitFor(() => {
      expect(screen.getByText(/Select an action type/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "purchase.initiate" },
    });

    fireEvent.click(screen.getByText("Test Authorization"));

    await waitFor(() => {
      expect(screen.getByText("Allow")).toBeInTheDocument();
    });
  });
});
