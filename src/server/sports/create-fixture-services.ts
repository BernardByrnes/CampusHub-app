import "server-only";

import { ListFixturesService } from "@/application/sports/list-fixtures";
import { FixtureManagementService } from "@/application/sports/manage-fixtures";
import { DrizzleFixtureRepository } from "@/server/repositories/fixture-repository";

export function createListFixturesService(): ListFixturesService {
  return new ListFixturesService({ fixtures: new DrizzleFixtureRepository() });
}

export function createFixtureManagementService(
  dependencies: ConstructorParameters<typeof FixtureManagementService>[0],
): FixtureManagementService {
  return new FixtureManagementService(dependencies);
}
