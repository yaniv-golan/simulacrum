import { verifyArchitectureGuardFixtures } from "../test/architecture/guard-fixtures.test.js";

const result = await verifyArchitectureGuardFixtures();
console.log(`architecture guard fixtures passed (${result.cases} cases)`);
