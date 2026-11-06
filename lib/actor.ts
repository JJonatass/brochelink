import "server-only";
import type { Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BroochStatus } from "@/lib/brooches/transitions";

export type BroochRow = {
  id: string;
  public_code: string;
  status: BroochStatus;
  owner_id: string | null;
  destination_url: string | null;
  batch_id: string | null;
  sequence_in_batch: number | null;
};

/**
 * Autorização no servidor: o proprietário age como "owner"; um admin que não
 * é o dono age como "admin". Qualquer outra pessoa recebe "não encontrado"
 * (não revelamos a existência de broches alheios).
 */
export async function resolveActor(
  profile: Profile,
  broochId: string,
): Promise<{ brooch: BroochRow; actor: "owner" | "admin" } | null> {
  const { data } = await createAdminClient()
    .from("brooches")
    .select("id, public_code, status, owner_id, destination_url, batch_id, sequence_in_batch")
    .eq("id", broochId)
    .maybeSingle();
  if (!data) return null;
  const brooch = data as BroochRow;
  if (brooch.owner_id && brooch.owner_id === profile.id) return { brooch, actor: "owner" };
  if (profile.role === "admin") return { brooch, actor: "admin" };
  return null;
}
