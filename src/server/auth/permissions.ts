import type { Role } from "@prisma/client";

// Role-based access. Kept as a flat permission list so a custom-role model can replace it later.
export type Permission =
  | "scorecard:view"
  | "actions:view"
  | "actions:review"
  | "rules:view"
  | "rules:edit"
  | "autonomy:view"
  | "autonomy:change"
  | "replay:view"
  | "replay:run"
  | "audit:view"
  | "audit:export"
  | "settings:view"
  | "settings:edit";

const ALL: Permission[] = [
  "scorecard:view", "actions:view", "actions:review", "rules:view", "rules:edit",
  "autonomy:view", "autonomy:change", "replay:view", "replay:run",
  "audit:view", "audit:export", "settings:view", "settings:edit",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  controller: ALL.filter((p) => p !== "settings:edit"),
  reviewer: ["scorecard:view", "actions:view", "actions:review", "rules:view", "autonomy:view", "replay:view", "audit:view"],
  auditor: ["scorecard:view", "actions:view", "rules:view", "autonomy:view", "replay:view", "audit:view", "audit:export"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Approval authority. A person can only decide actions whose required role is at or below theirs. */
export const APPROVER_RANK: Record<Role, number> = { auditor: 0, reviewer: 1, controller: 2, admin: 3 };

export function canApproveAtLevel(role: Role, required: Role | null | undefined): boolean {
  if (APPROVER_RANK[role] === 0) return false;
  return APPROVER_RANK[role] >= APPROVER_RANK[required ?? "reviewer"];
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  controller: "Controller",
  reviewer: "Reviewer",
  auditor: "Auditor (read-only)",
};
