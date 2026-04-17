import { useUser } from "@clerk/react";
import { useEffect, useRef } from "react";

export function useAuthSync() {
  const { user, isLoaded, isSignedIn } = useUser();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (isLoaded && isSignedIn && user && !hasSynced.current) {
      hasSynced.current = true;
      fetch("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: user.primaryEmailAddress?.emailAddress,
          firstName: user.firstName,
          lastName: user.lastName,
        }),
      }).catch(err => console.error("Failed to sync user:", err));
    }
  }, [user, isLoaded, isSignedIn]);
}
