import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { forOrg } from "./db/dal";

// File storage seam. Local disk for the MVP; swap for S3/GCS by reimplementing these two functions.

function root() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

export async function storeFile(organisationId: string, file: { filename: string; contentType: string; bytes: Uint8Array }) {
  const key = `${organisationId}/${randomUUID()}-${file.filename.replace(/[^\w.\-]+/g, "_")}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes);
  return forOrg(organisationId).storedFile.create({
    data: {
      organisationId, filename: file.filename, contentType: file.contentType, sizeBytes: file.bytes.byteLength,
      sha256: createHash("sha256").update(file.bytes).digest("hex"), storageKey: key,
    },
  });
}

export async function readStoredFile(organisationId: string, fileId: string) {
  const meta = await forOrg(organisationId).storedFile.findFirst({ where: { id: fileId } });
  if (!meta) return null;
  return { meta, bytes: await readFile(path.join(root(), meta.storageKey)) };
}
