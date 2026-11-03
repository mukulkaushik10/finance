"use client";

import { Button } from "@/components/ui";

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      Sign out
    </Button>
  );
}
