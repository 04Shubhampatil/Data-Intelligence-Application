import Link from "next/link";
import { FileQuestion, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";

/** A record that doesn't exist, or one outside the user's district — shown inside the app shell. */
export default function DashboardNotFound() {
  return (
    <StatusScreen
      icon={FileQuestion}
      code="404"
      title="Not found"
      description="This record doesn't exist, was removed, or isn't available to your account."
      actions={
        <Button variant="outline" asChild>
          <Link href="/candidates">
            <Users />
            Back to records
          </Link>
        </Button>
      }
    />
  );
}
