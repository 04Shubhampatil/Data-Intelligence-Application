import { Download, FileQuestion, FileWarning, Lock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocumentView } from "@/server/services/document.service";
import { formatDateTime, formatNumber } from "@/lib/format";

const STATUS: Record<string, { label: string; cls: string }> = {
  STORED: { label: "Available", cls: "border-0 bg-success/10 text-success" },
  MISSING_AT_SOURCE: { label: "Not uploaded at source", cls: "border-0 bg-muted text-muted-foreground" },
  UNSUPPORTED: { label: "Unsupported file", cls: "border-0 bg-brand-orange/15 text-brand-orange" },
  FAILED: { label: "Download failed", cls: "border-0 bg-destructive/10 text-destructive" },
  QUARANTINED: { label: "Quarantined (malware)", cls: "border-0 bg-destructive/10 text-destructive" },
};

const CATEGORY: Record<string, string> = { photo: "Photo", education: "Education", employment: "Employment", identity: "Identity", bank: "Bank", other: "Other" };

/** Thumbnails + download links for a candidate's stored files. Links are signed per user and expire in 10 minutes. */
export function DocumentsGrid({ documents, notApproved }: { documents: DocumentView[]; notApproved: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded documents</CardTitle>
        <CardDescription>
          Copies kept in private storage; every preview and download is logged. Links expire after 10 minutes.
          {notApproved.length > 0 && <> Not collected (not approved): {notApproved.join(", ")}.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No documents have been synced for this record yet. They are collected when the profile page is read.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {documents.map((d) => {
              const st = STATUS[d.status] ?? { label: d.status, cls: "" };
              const isImage = d.mimeType?.startsWith("image/");
              return (
                <li key={d.id} className="overflow-hidden rounded-xl border bg-card">
                  <div className="flex h-36 items-center justify-center bg-muted/50">
                    {d.previewUrl && isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.previewUrl} alt={d.label} className="h-full w-full object-cover" loading="lazy" />
                    ) : d.previewUrl ? (
                      <FileQuestion className="size-10 text-muted-foreground" />
                    ) : d.status === "QUARANTINED" ? (
                      <ShieldAlert className="size-10 text-destructive" />
                    ) : (
                      <FileWarning className="size-10 text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-1.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{d.label}</p>
                        <p className="text-[11px] capitalize text-muted-foreground">{CATEGORY[d.category] ?? d.category}{d.encrypted && <><Lock className="ml-1 mr-0.5 inline size-3" />encrypted</>}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={st.cls}>{st.label}</Badge>
                        {d.sourceVerification && (
                          <Badge className={d.sourceVerification === "Verified" ? "border-0 bg-success/10 text-success" : d.sourceVerification === "Rejected" ? "border-0 bg-destructive/10 text-destructive" : "border-0 bg-muted text-muted-foreground"}>
                            {d.sourceVerification} at source
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground" title={d.originalName}>{d.originalName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.mimeType ?? "—"}{d.sizeBytes ? ` · ${formatNumber(Math.round(d.sizeBytes / 1024))} KB` : ""} · {formatDateTime(d.extractedAt)}
                      {d.scanStatus === "skipped" && " · not virus-scanned"}
                    </p>
                    {d.error && <p className="text-[11px] text-destructive">{d.error}</p>}
                    {d.downloadUrl && (
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" asChild>
                          <a href={d.previewUrl} target="_blank" rel="noopener noreferrer">Preview</a>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={d.downloadUrl} download><Download /> Download</a>
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
