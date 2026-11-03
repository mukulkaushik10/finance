import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { badRequest } from "@/server/errors";
import { createDataset, listDatasets } from "@/server/replay/service";
import { getPrimaryWorkflow } from "@/server/workflows/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "replay:view");
  return json({ datasets: await listDatasets(ctx) });
});

/** Multipart upload: `csv` (required), `pdfs` (optional, repeated), `name`, `workflowId` (optional). */
export const POST = route(async (req) => {
  const ctx = await requireCtx(req, "replay:run");
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("Send the file as multipart/form-data"); }
  const csv = form.get("csv");
  if (!csv || typeof csv === "string") throw badRequest("Attach a CSV file in the `csv` field");
  const workflowId = (form.get("workflowId") as string | null) || (await getPrimaryWorkflow(ctx)).id;
  const pdfs = await Promise.all(
    form.getAll("pdfs").filter((f): f is File => typeof f !== "string").map(async (f) => ({
      filename: f.name, contentType: f.type || "application/pdf", bytes: new Uint8Array(await f.arrayBuffer()),
    })),
  );
  const name = ((form.get("name") as string | null) || csv.name.replace(/\.csv$/i, "") || "Replay set").slice(0, 120);
  const result = await createDataset(ctx, workflowId, { name, csvText: await csv.text(), pdfs });
  return json(result, 201);
});
