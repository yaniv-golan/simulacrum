import { testSiteShapeContains } from "../../model/test-site-shapes.js";
import { supportMaterialResponse } from "../../model/contact-material-pairs.js";

export function testSiteSupportContact(partId, contact) {
  const supported =
    String(contact.otherBodyId || "").startsWith("environment:") &&
    Number(contact.normal?.y) > 0.2;
  if (!supported || !contact.otherMaterialKey) return null;
  const response = supportMaterialResponse(contact.otherMaterialKey),
    sinkageM = response.foundationStiffnessNPerM
      ? Math.min(
          response.maximumSinkageM,
          contact.forceN / response.foundationStiffnessNPerM,
        )
      : 0;
  return {
    partId,
    otherBodyId: contact.otherBodyId,
    otherShapeId: contact.otherShapeId,
    materialKey: contact.otherMaterialKey,
    point: contact.point,
    normal: contact.normal,
    forceN: contact.forceN,
    relativeVelocity: contact.relativeVelocity,
    surfaceSinkageM: sinkageM,
    maximumSinkageM: response.maximumSinkageM,
  };
}

function componentBodies(component, bodyRegistry) {
  const bodies = [
    ...(component.physicalEntityIds || [])
      .map((bodyId) => bodyRegistry.body(bodyId))
      .filter(Boolean),
    ...(component.bodyPartIds || []).flatMap((partId) =>
      bodyRegistry.bodiesForPart(partId),
    ),
  ];
  return [...new Map(bodies.map((body) => [body.bodyId, body])).values()];
}

function bodyMass(body) {
  return Math.max(
    0.001,
    Number(body.massProperties?.massKg) ||
      (body.descriptors || []).reduce(
        (sum, descriptor) => sum + Number(descriptor.massKg || 0),
        0,
      ) ||
      0.001,
  );
}

function componentKinematics(component, bodyRegistry) {
  let mass = 0,
    x = 0,
    y = 0,
    z = 0,
    vx = 0,
    vy = 0,
    vz = 0,
    grounded = false,
    supportContacts = [];
  for (const body of componentBodies(component, bodyRegistry)) {
    const massKg = bodyMass(body),
      partId = body.partIds[0];
    mass += massKg;
    x += body.pose.position.x * massKg;
    y += body.pose.position.y * massKg;
    z += body.pose.position.z * massKg;
    vx += body.velocity.x * massKg;
    vy += body.velocity.y * massKg;
    vz += body.velocity.z * massKg;
    for (const contact of body.contacts || []) {
      const projection = testSiteSupportContact(partId, contact);
      grounded ||= Boolean(projection);
      if (projection) supportContacts.push(projection);
    }
  }
  if (!mass) return null;
  const position = { x: x / mass, y: y / mass, z: z / mass },
    velocity = { x: vx / mass, y: vy / mass, z: vz / mass };
  return {
    position,
    velocity,
    speedMps: Math.hypot(velocity.x, velocity.y, velocity.z),
    grounded,
    supportContacts,
  };
}

function project(context) {
  const runtime = context.services.multibodyRuntime,
    index = context.services.physicalAssemblyIndex,
    testSite = context.services.testSite,
    sampleAt = context.services.surfaceSampleAt;
  if (!runtime?.compiled || !index || !testSite || !sampleAt) return null;
  return {
    siteId: testSite.id,
    components: index
      .snapshot()
      .components.map((component) => {
        const kinematics = componentKinematics(component, context.bodyRegistry);
        if (!kinematics) return null;
        const { position } = kinematics;
        const sample = sampleAt(position.x, position.z);
        return {
          componentId: component.id,
          partIds: component.partIds,
          position,
          velocity: kinematics.velocity,
          speedMps: kinematics.speedMps,
          grounded: kinematics.grounded,
          inside: sample.inside,
          districtId: sample.districtId,
          surfaceRegionId: sample.surfaceRegionId,
          materialKey: sample.materialKey,
          featureIds: sample.featureIds,
          fluidId: sample.fluid?.id || null,
          supportContacts: kinematics.supportContacts,
          supportMaterialKeys: [
            ...new Set(
              kinematics.supportContacts.map(({ materialKey }) => materialKey),
            ),
          ].sort(),
          zoneIds: testSite.zones
            .filter(({ shape }) =>
              testSiteShapeContains(shape, position.x, position.z),
            )
            .map(({ id }) => id),
        };
      })
      .filter(Boolean),
  };
}

/** Publishes completed machine location against the canonical Test Reserve. */
export class TestSiteTelemetrySystem {
  phase = "telemetry";

  initialize(context) {
    const snapshot = project(context);
    if (!snapshot) return;
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.testSite = snapshot;
  }

  step(context) {
    const snapshot = project(context);
    if (snapshot) context.telemetry.testSite = snapshot;
  }
}
