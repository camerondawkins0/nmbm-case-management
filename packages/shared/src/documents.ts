import { z } from "zod";

export const DOCUMENT_STATUSES = ["pending", "uploaded", "voided"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// What can be uploaded: scans and photos of paper. Not office documents,
// which can carry macros, and not HTML or SVG, which a browser would run.
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

// A phone photo of a form, or a multi-page scan.
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const documentUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES, {
    errorMap: () => ({ message: "Upload a PDF or a photo (JPEG, PNG, HEIC or WebP)" }),
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(DOCUMENT_MAX_BYTES, { message: "Files can be up to 10 MB" }),
  description: z.string().trim().min(1).max(300),
  consentId: z.string().uuid().optional(),
});
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

export const documentVoidSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type DocumentVoid = z.infer<typeof documentVoidSchema>;
