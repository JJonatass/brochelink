/**
 * Regras de transição de status — espelho exato de public.set_brooch_status.
 * Usado pela interface (quais botões mostrar) e coberto por testes que
 * comparam este módulo com a função SQL.
 */
export type BroochStatus = "available" | "active" | "suspended" | "revoked";
export type ActorKind = "owner" | "admin" | "system";
export type StatusAction = "suspend" | "reactivate" | "revoke";

export type BroochForTransition = {
  status: BroochStatus;
  owner_id: string | null;
  destination_url: string | null;
  suspended_by: ActorKind | null;
};

export function nextStatus(
  b: BroochForTransition,
  actor: { kind: "owner" | "admin"; id: string },
  action: StatusAction,
): BroochStatus | null {
  if (actor.kind === "owner") {
    if (b.owner_id !== actor.id) return null;
    if (action === "suspend" && b.status === "active") return "suspended";
    if (action === "reactivate" && b.status === "suspended" && b.suspended_by === "owner") return "active";
    return null;
  }
  if (action === "suspend" && (b.status === "available" || b.status === "active")) return "suspended";
  if (action === "reactivate" && b.status === "suspended") {
    return b.owner_id && b.destination_url ? "active" : "available";
  }
  if (action === "revoke" && b.status !== "revoked") return "revoked";
  return null;
}

export function allowedActions(b: BroochForTransition, actor: { kind: "owner" | "admin"; id: string }): StatusAction[] {
  return (["suspend", "reactivate", "revoke"] as const).filter((a) => nextStatus(b, actor, a) !== null);
}

export const STATUS_LABELS: Record<BroochStatus, string> = {
  available: "Disponível",
  active: "Ativo",
  suspended: "Suspenso",
  revoked: "Revogado",
};

export const ACTION_LABELS: Record<StatusAction, string> = {
  suspend: "Suspender",
  reactivate: "Reativar",
  revoke: "Revogar",
};
