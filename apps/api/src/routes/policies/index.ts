import { Hono } from "hono";
import type { DrizzleDB } from "@warranted/rules-engine";
import { rulesRoutes } from "./rules";
import { groupsRoutes } from "./groups";
import { assignmentsRoutes } from "./assignments";
import { envelopeRoutes } from "./envelope";
import { checkRoutes } from "./check";
import { decisionsRoutes } from "./decisions";
import { actionTypesRoutes } from "./action-types";
import { petitionsRoutes } from "./petitions";
import { organizationsRoutes } from "./organizations";

export function policyRoutes(db: DrizzleDB): Hono {
  const app = new Hono();

  app.route("/organizations", organizationsRoutes(db));
  app.route("/rules", rulesRoutes(db));
  app.route("/groups", groupsRoutes(db));
  app.route("/assignments", assignmentsRoutes(db));
  app.route("/action-types", actionTypesRoutes(db));
  app.route("/decisions", decisionsRoutes(db));
  app.route("/petitions", petitionsRoutes());

  // Envelope and check routes are mounted at the policy level
  // (envelope routes use /agents/:did/... prefix, check uses /check)
  app.route("/", envelopeRoutes(db));
  app.route("/", checkRoutes(db));

  return app;
}
