import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusScreen
      fullPage
      icon={FileQuestion}
      code="404"
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved. Check the address, or head back to the dashboard."
      actions={
        <Button asChild>
          <Link href="/">
            <Home />
            Go to dashboard
          </Link>
        </Button>
      }
    />
  );
}
