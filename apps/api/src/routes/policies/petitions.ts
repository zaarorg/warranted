import { Hono } from "hono";
import { PetitionResponseShape } from "@warranted/rules-engine";

export function petitionsRoutes(): Hono {
  const app = new Hono();

  // POST /petitions — File petition (stub)
  app.post("/", (c) => {
    return c.json(
      {
        status: 501,
        message:
          "Petitioning is not yet implemented. See docs/plans/rules-engine-SPEC.md for the planned workflow.",
        plannedResponseShape: PetitionResponseShape,
      },
      501,
    );
  });

  // GET /petitions — List petitions (stub)
  app.get("/", (c) => {
    return c.json(
      {
        status: 501,
        message: "Petitioning is not yet implemented.",
        plannedResponseShape: { petitions: [PetitionResponseShape] },
      },
      501,
    );
  });

  // POST /petitions/:id/decide — Approve/deny petition (stub)
  app.post("/:id/decide", (c) => {
    return c.json(
      {
        status: 501,
        message: "Petitioning is not yet implemented.",
        plannedResponseShape: PetitionResponseShape,
      },
      501,
    );
  });

  // GET /petitions/:id — Get petition details (stub)
  app.get("/:id", (c) => {
    return c.json(
      {
        status: 501,
        message: "Petitioning is not yet implemented.",
        plannedResponseShape: PetitionResponseShape,
      },
      501,
    );
  });

  return app;
}
