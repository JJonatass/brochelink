/**
 * Jornada de ativação (Modelo A) e alteração de destino.
 */
import { isValidPublicCode, normalizeCode, verifyActivationCode } from "@/lib/codes";
import { validateDestinationUrl, type UrlValidationError } from "@/lib/url-validation";
import type { ActorKind } from "@/lib/brooches/transitions";
import type { Store } from "@/lib/store/types";

export type DestinationPolicy = {
  appHosts: string[];
  /** true = destino sinalizado como malicioso por serviço externo */
  isFlagged?: (url: string) => Promise<boolean>;
};

export type ActivationOptions = DestinationPolicy & {
  pepper: string;
  maxAttempts: number;
  lockSeconds: number;
  now?: () => Date;
};

export type ActivationResult =
  | { ok: true; broochId: string }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_available"; alreadyYours: boolean }
  | { ok: false; error: "locked"; lockedUntil: string }
  | { ok: false; error: "invalid_code"; remainingAttempts: number; lockedUntil: string | null }
  | { ok: false; error: "invalid_url"; reason: UrlValidationError }
  | { ok: false; error: "conflict" };

export async function checkDestination(
  store: Store,
  url: string,
  policy: DestinationPolicy,
): Promise<{ ok: true; url: string } | { ok: false; reason: UrlValidationError }> {
  const blockedDomains = await store.listBlockedDomains();
  const result = validateDestinationUrl(url, { appHosts: policy.appHosts, blockedDomains });
  if (!result.ok) return { ok: false, reason: result.error };
  if (policy.isFlagged && (await policy.isFlagged(result.url))) return { ok: false, reason: "blocked" };
  return { ok: true, url: result.url };
}

export async function activateBrooch(
  store: Store,
  input: { publicCode: string; activationCode: string; destinationUrl: string; userId: string },
  opts: ActivationOptions,
): Promise<ActivationResult> {
  const now = opts.now?.() ?? new Date();
  const publicCode = normalizeCode(input.publicCode);
  if (!isValidPublicCode(publicCode)) return { ok: false, error: "not_found" };

  const brooch = await store.findBroochByCode(publicCode);
  if (!brooch) return { ok: false, error: "not_found" };
  if (brooch.status !== "available") {
    return { ok: false, error: "not_available", alreadyYours: brooch.owner_id === input.userId };
  }

  const credential = await store.getCredential(brooch.id);
  if (!credential || credential.used_at) return { ok: false, error: "not_available", alreadyYours: false };
  if (credential.locked_until && new Date(credential.locked_until) > now) {
    return { ok: false, error: "locked", lockedUntil: credential.locked_until };
  }

  // Validação sintática da URL antes de consumir uma tentativa de código
  const syntactic = validateDestinationUrl(input.destinationUrl, { appHosts: opts.appHosts });
  if (!syntactic.ok) return { ok: false, error: "invalid_url", reason: syntactic.error };

  const valid = verifyActivationCode(opts.pepper, brooch.id, credential.code_version, input.activationCode, credential.code_hash);
  if (!valid) {
    const r = await store.registerFailedActivation(brooch.id, opts.maxAttempts, opts.lockSeconds);
    const failed = r?.failed_attempts ?? credential.failed_attempts + 1;
    const lockedUntil = r?.locked_until && new Date(r.locked_until) > now ? r.locked_until : null;
    return {
      ok: false,
      error: "invalid_code",
      remainingAttempts: lockedUntil ? 0 : opts.maxAttempts - (failed % opts.maxAttempts),
      lockedUntil,
    };
  }

  const destination = await checkDestination(store, input.destinationUrl, opts);
  if (!destination.ok) return { ok: false, error: "invalid_url", reason: destination.reason };

  const activated = await store.activateBrooch(brooch.id, input.userId, destination.url, credential.code_version);
  return activated ? { ok: true, broochId: brooch.id } : { ok: false, error: "conflict" };
}

export async function changeDestination(
  store: Store,
  input: { broochId: string; actorId: string; actor: ActorKind; url: string },
  policy: DestinationPolicy,
): Promise<{ ok: true; url: string; previous: string | null } | { ok: false; reason: UrlValidationError }> {
  const destination = await checkDestination(store, input.url, policy);
  if (!destination.ok) return destination;
  const previous = await store.updateDestination(input.broochId, input.actorId, input.actor, destination.url);
  return { ok: true, url: destination.url, previous };
}
