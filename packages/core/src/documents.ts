/** Document kinds the app knows, their labels, sensitivity and default approval. */
export const DOCUMENT_KINDS = [
  "PROFILE_PHOTO", "RESUME", "A_FORM", "SSC_CERTIFICATE", "HSC_CERTIFICATE", "OTHER_CERTIFICATE",
  "AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "BANK_PASSBOOK", "OTHER",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_DEFS: Record<DocumentKind, { label: string; identity: boolean; defaultAllowed: boolean }> = {
  PROFILE_PHOTO: { label: "Profile photo", identity: false, defaultAllowed: true },
  RESUME: { label: "Resume", identity: false, defaultAllowed: true },
  A_FORM: { label: "A Form", identity: false, defaultAllowed: true },
  SSC_CERTIFICATE: { label: "SSC certificate", identity: false, defaultAllowed: true },
  HSC_CERTIFICATE: { label: "HSC certificate", identity: false, defaultAllowed: true },
  OTHER_CERTIFICATE: { label: "Other certificate", identity: false, defaultAllowed: true },
  AADHAAR_FRONT: { label: "Aadhaar (front)", identity: true, defaultAllowed: false },
  AADHAAR_BACK: { label: "Aadhaar (back)", identity: true, defaultAllowed: false },
  PAN: { label: "PAN card", identity: true, defaultAllowed: false },
  BANK_PASSBOOK: { label: "Bank passbook", identity: true, defaultAllowed: false },
  OTHER: { label: "Other document", identity: false, defaultAllowed: false },
};

export const isDocumentKind = (v: unknown): v is DocumentKind => typeof v === "string" && (DOCUMENT_KINDS as readonly string[]).includes(v);

/** Allowed file types and size for anything we copy from the source. */
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
export const DOCUMENT_MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Detects the real type from magic bytes — headers from the source are not trusted. */
export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return null;
}
