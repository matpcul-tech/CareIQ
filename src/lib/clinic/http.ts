import {
  addCareTeamStaff,
  addCheckin,
  addCircleMember,
  addConcern,
  addHomeReading,
  clinicGaps,
  clinicMeasures,
  clinicTracking,
  addScreen,
  clinicScorecard,
  clinicWorklist,
  importRegistry,
  setMeasureTargets,
  listCircle,
  listConcerns,
  logMinutes,
  logOutreach,
  markWellnessOk,
  maskedInsight,
  notifySms,
  openClinic,
  optInWellness,
  recordCancerFollowUp,
  recordCancerResult,
  recordCognitive,
  recordFalls,
  recordStrain,
  revokeCircleMember,
  setBarriers,
  setClinicThresholds,
  tickWellness,
} from "./actions";
import type { Actor, CircleRole, StaffRole } from "./logic";
import type { SmsEnv } from "./sms";
import type { ClinicStore } from "./store";

export interface ClinicHttpDeps {
  store: ClinicStore;
  actor: Actor | null;
  smsEnv: SmsEnv;
  fetchImpl?: typeof fetch;
  asOf: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}

export async function handleClinicHttp(req: Request, deps: ClinicHttpDeps): Promise<Response> {
  if (!deps.actor) return json({ error: "authentication required" }, 401);
  const actor = deps.actor;
  if (req.method === "GET") {
    const url = new URL(req.url);
    const view = url.searchParams.get("view") || "worklist";
    if (view === "worklist") {
      const result = await clinicWorklist(deps.store, actor, deps.asOf);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "measures") {
      const result = await clinicMeasures(deps.store, actor, deps.asOf);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "scorecard") {
      const result = await clinicScorecard(deps.store, actor, deps.asOf);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "gaps") {
      const result = await clinicGaps(deps.store, actor, deps.asOf);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "tracking") {
      const id = url.searchParams.get("clinicPatientId") || "";
      const month = url.searchParams.get("month") || deps.asOf.slice(0, 7);
      const result = await clinicTracking(deps.store, actor, id, month);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "circle") {
      const id = url.searchParams.get("clinicPatientId") || "";
      const result = await listCircle(deps.store, actor, id);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    if (view === "messages") {
      const id = url.searchParams.get("clinicPatientId") || "";
      const result = await listConcerns(deps.store, actor, id);
      return json(result.ok ? result.data : { error: result.error }, result.ok ? 200 : result.status);
    }
    return json({ error: "unknown view" }, 400);
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 500_000) return json({ error: "payload too large" }, 413);
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const result = await dispatch(deps, actor, action, body);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result.data);
}

async function dispatch(
  deps: ClinicHttpDeps,
  actor: Actor,
  action: string,
  body: Record<string, unknown>,
) {
  const id = typeof body.clinicPatientId === "string" ? body.clinicPatientId : "";
  if (action === "open_clinic") {
    return openClinic(deps.store, actor, {
      name: String(body.name || "Clinic"),
      externalId: String(body.externalId || "SYN-LOCAL"),
    });
  }
  if (action === "add_staff") {
    const role = body.role === "provider" || body.role === "ma" || body.role === "chw" ? body.role : null;
    if (!role) return { ok: false as const, status: 400, error: "role must be provider, ma, or chw" };
    return addCareTeamStaff(deps.store, actor, {
      clinicId: String(body.clinicId || ""),
      role: role as StaffRole,
      displayName: String(body.displayName || "Clinic staff"),
      phone: typeof body.phone === "string" ? body.phone : null,
    });
  }
  if (action === "import") return importRegistry(deps.store, actor, String(body.csv || ""));
  if (action === "thresholds") {
    const patch: Record<string, number> = {};
    for (const key of ["bp_systolic", "bp_diastolic", "glucose_high", "glucose_low", "a1c"]) {
      const value = num(body[key]);
      if (value != null) patch[key] = value;
    }
    return setClinicThresholds(deps.store, actor, patch);
  }
  if (action === "reading") {
    const kind = body.kind === "glucose" ? "glucose" : "bp";
    return addHomeReading(deps.store, actor, {
      clinicPatientId: id,
      reading: {
        kind,
        systolic: num(body.systolic),
        diastolic: num(body.diastolic),
        glucose: num(body.glucose),
        recorded_on: String(body.recorded_on || deps.asOf),
      },
    });
  }
  if (action === "message") {
    return addConcern(deps.store, actor, { clinicPatientId: id, body: String(body.body || ""), on: deps.asOf });
  }
  if (action === "checkin") {
    const kind = body.kind === "appointment" ? "appointment" : "medication";
    const status = body.status === "completed" ? "completed" : "missed";
    return addCheckin(deps.store, actor, { clinicPatientId: id, kind, status, on: String(body.on || deps.asOf) });
  }
  if (action === "add_member") {
    const role = memberRole(body.role);
    if (!role) return { ok: false as const, status: 400, error: "role is not allowed" };
    return addCircleMember(deps.store, actor, { clinicPatientId: id, role, displayName: String(body.displayName || "Member") });
  }
  if (action === "revoke") {
    return revokeCircleMember(deps.store, actor, { memberId: String(body.memberId || ""), at: deps.asOf });
  }
  if (action === "outreach") {
    const outcome = outreachOutcome(body.outcome);
    if (!outcome) return { ok: false as const, status: 400, error: "outcome is not allowed" };
    return logOutreach(deps.store, actor, { clinicPatientId: id, outcome, on: deps.asOf });
  }
  if (action === "minutes") {
    return logMinutes(deps.store, actor, {
      clinicPatientId: id,
      month: String(body.month || deps.asOf.slice(0, 7)),
      minutes: num(body.minutes) || 0,
    });
  }
  if (action === "screen") {
    return addScreen(deps.store, actor, {
      clinicPatientId: id,
      instrument: String(body.instrument || ""),
      score: num(body.score) || 0,
      followUp: body.follow_up === true,
      on: String(body.on || deps.asOf),
    });
  }
  if (action === "targets") {
    const patch: Record<string, number> = {};
    if (body.targets && typeof body.targets === "object") {
      for (const [key, value] of Object.entries(body.targets as Record<string, unknown>)) {
        const parsed = num(value);
        if (parsed == null) return { ok: false as const, status: 400, error: "target must be from 0 to 1" };
        patch[key] = parsed;
      }
    }
    return setMeasureTargets(deps.store, actor, patch, deps.asOf);
  }
  if (action === "cancer_result") {
    const kind = body.kind === "breast" || body.kind === "cervical" ? body.kind : body.kind === "colorectal" ? "colorectal" : null;
    const result = body.result === "abnormal" ? "abnormal" : body.result === "normal" ? "normal" : null;
    if (!kind || !result) return { ok: false as const, status: 400, error: "kind and result are required" };
    return recordCancerResult(deps.store, actor, {
      clinicPatientId: id,
      kind,
      method: String(body.method || "fit"),
      result,
      on: String(body.on || deps.asOf),
    });
  }
  if (action === "cancer_followup") {
    return recordCancerFollowUp(deps.store, actor, { eventId: String(body.eventId || ""), on: String(body.on || deps.asOf) });
  }
  if (action === "barriers") {
    return setBarriers(deps.store, actor, { clinicPatientId: id, cost: body.cost === true, transport: body.transport === true });
  }
  if (action === "wellness_opt_in") {
    return optInWellness(deps.store, actor, {
      clinicPatientId: id,
      optedIn: body.opted_in === true,
      livesAlone: body.lives_alone === true,
      phone: typeof body.phone === "string" ? body.phone : null,
      familyPhone: typeof body.family_phone === "string" ? body.family_phone : null,
    });
  }
  if (action === "wellness_ok") {
    return markWellnessOk(deps.store, actor, { clinicPatientId: id, at: String(body.at || `${deps.asOf}T12:00:00Z`) });
  }
  if (action === "wellness_tick") {
    return tickWellness(deps.store, actor, { nowIso: String(body.at || `${deps.asOf}T12:00:00Z`), env: deps.smsEnv, fetchImpl: deps.fetchImpl });
  }
  if (action === "cognitive") {
    return recordCognitive(deps.store, actor, { clinicPatientId: id, score: num(body.score) || 0, on: String(body.on || deps.asOf) });
  }
  if (action === "falls") {
    return recordFalls(deps.store, actor, { clinicPatientId: id, atRisk: body.at_risk === true, on: String(body.on || deps.asOf) });
  }
  if (action === "strain") {
    return recordStrain(deps.store, actor, { clinicPatientId: id, score: num(body.score) || 0, on: String(body.on || deps.asOf) });
  }
  if (action === "insight") return maskedInsight(deps.store, actor, id);
  if (action === "sms") {
    return notifySms(deps.store, actor, { clinicPatientId: id, env: deps.smsEnv, fetchImpl: deps.fetchImpl });
  }
  return { ok: false as const, status: 400, error: "unknown action" };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function memberRole(value: unknown): CircleRole | null {
  if (value === "admin" || value === "caregiver" || value === "viewer" || value === "provider" || value === "ma" || value === "chw") {
    return value;
  }
  return null;
}

function outreachOutcome(value: unknown): "contacted" | "scheduled" | "closed" | "no_answer" | "declined" | null {
  if (value === "contacted" || value === "scheduled" || value === "closed" || value === "no_answer" || value === "declined") {
    return value;
  }
  return null;
}
