import "server-only";
import { prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope, lookupScope } from "@/server/auth/scope";

export type Option = { value: string; label: string };

async function distinct(field: "employeeType" | "gender" | "educationType", user: CurrentUser): Promise<Option[]> {
  const rows = await prisma.candidate.findMany({
    where: { [field]: { not: null }, ...candidateScope(user) },
    distinct: [field],
    select: { [field]: true },
    orderBy: { [field]: "asc" },
  });
  return rows
    .map((r) => (r as unknown as Record<string, string | null>)[field])
    .filter((v): v is string => !!v)
    .map((v) => ({ value: v, label: v }));
}

/** Options for every filter on the Resource Records page. */
export async function getFilterOptions(user: CurrentUser) {
  const scope = user.districtScopeIds;
  const inScope = lookupScope(user);
  const [districts, departmentHeads, departments, subProjects, designations, employeeTypes, genders, educationTypes] = await Promise.all([
    prisma.district.findMany({ where: scope.length ? { id: { in: scope } } : {}, orderBy: { name: "asc" } }),
    prisma.departmentHead.findMany({ where: inScope, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: inScope, orderBy: { name: "asc" } }),
    prisma.subProject.findMany({ where: inScope, orderBy: { name: "asc" } }),
    prisma.designation.findMany({ where: inScope, orderBy: { name: "asc" } }),
    distinct("employeeType", user),
    distinct("gender", user),
    distinct("educationType", user),
  ]);
  const opt = (r: { id: string; name: string }) => ({ value: r.id, label: r.name });
  return {
    districts: districts.map(opt),
    departmentHeads: departmentHeads.map(opt),
    departments: departments.map(opt),
    subProjects: subProjects.map((s) => ({ ...opt(s), parent: s.departmentHeadId })),
    designations: designations.map(opt),
    employeeTypes,
    genders,
    educationTypes,
  };
}

export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;
