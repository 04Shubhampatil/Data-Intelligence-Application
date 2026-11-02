import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Candidate photo in a ring, like the source dashboard's employee list: the stored profile photo
 * (via a signed, user-bound link) with a green ring, or a grey silhouette when there is none,
 * the user may not view documents, or the image fails to load.
 */
export function CandidateAvatar({ photoUrl, name, size = "md" }: { photoUrl?: string | null; name: string; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-11";
  return (
    <span className={cn("inline-flex shrink-0 rounded-full p-0.5 ring-2", photoUrl ? "ring-success" : "ring-border")}>
      <Avatar className={dim}>
        {photoUrl && <AvatarImage src={photoUrl} alt={`Photo of ${name}`} className="object-cover" />}
        <AvatarFallback className="bg-muted text-muted-foreground" aria-label={photoUrl ? `Photo of ${name}` : "No photo"}>
          <UserRound className="size-3/5" />
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
