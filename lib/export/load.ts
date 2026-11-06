import "server-only";
import { deriveActivationCode } from "@/lib/codes";
import { publicBroochUrl, serverConfig } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExportItem } from "./qr";

/** Carrega uma faixa de broches de um lote para exportação. */
export async function loadBatchItems(
  batchId: string,
  from: number,
  to: number,
  includeCodes: boolean,
): Promise<ExportItem[]> {
  const cfg = serverConfig();
  const { data, error } = await createAdminClient()
    .from("brooches")
    .select("id, public_code, sequence_in_batch, status, activation_credentials(code_version, used_at)")
    .eq("batch_id", batchId)
    .gte("sequence_in_batch", from)
    .lte("sequence_in_batch", to)
    .order("sequence_in_batch");
  if (error) throw new Error(error.message);

  return (data ?? []).map((b) => {
    const cred = (Array.isArray(b.activation_credentials) ? b.activation_credentials[0] : b.activation_credentials) as
      | { code_version: number; used_at: string | null }
      | null;
    const canShowCode = includeCodes && cred && !cred.used_at && b.status === "available";
    return {
      sequence: b.sequence_in_batch as number,
      publicCode: b.public_code as string,
      url: publicBroochUrl(cfg.NEXT_PUBLIC_APP_URL, b.public_code as string),
      activationCode: canShowCode ? deriveActivationCode(cfg.ACTIVATION_CODE_SECRET, b.id as string, cred.code_version) : undefined,
    };
  });
}
