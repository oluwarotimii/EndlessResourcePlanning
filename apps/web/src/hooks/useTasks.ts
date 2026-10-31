import { useEffect, useState } from "react";
import type { Task } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { useSession } from "../state/session";

export function useTasks() {
  const { api, token } = useSession();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<"unavailable" | "generic" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    let live = true;
    setError(null);
    api.tasks(token).then((r) => live && setTasks(r.tasks)).catch((e) => live && setError(e instanceof ApiFailure && e.code === "unavailable" ? "unavailable" : "generic"));
    return () => { live = false; };
  }, [api, token, attempt]);
  return { tasks, error, retry: () => setAttempt((n) => n + 1) };
}
