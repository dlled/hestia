import {
  type CapabilityDefinition,
  CapabilityDefinitionSchema,
  type CapabilityId,
} from "@hestia/contracts";

const definitions: CapabilityDefinition[] = [
  def("sensor.read", "Read sensor", "Read a normalized sensor value.", "R0", "idempotent"),
  def(
    "power.onOff",
    "Power on/off",
    "Switch power for lights, plugs, or appliances.",
    "R1",
    "idempotent",
  ),
  def("level.set", "Set level", "Set brightness, volume, or speed.", "R1", "idempotent"),
  def("color.set", "Set color", "Set light color or temperature.", "R1", "idempotent"),
  def("climate.setTarget", "Set climate target", "Set a climate setpoint.", "R2", "idempotent"),
  def(
    "climate.setMode",
    "Set climate mode",
    "Set HVAC mode (heat, cool, eco, off).",
    "R2",
    "idempotent",
  ),
  def(
    "cover.setPosition",
    "Set cover position",
    "Move blinds, shutters, or garage covers.",
    "R2",
    "idempotent",
  ),
  def(
    "valve.setOpen",
    "Set valve state",
    "Open or close a water, gas, or process valve.",
    "R3",
    "idempotent",
  ),
  def("lock.lock", "Lock", "Lock a door or gate.", "R3", "idempotent"),
  def("lock.unlock", "Unlock", "Unlock a door or gate.", "R3", "at_most_once"),
  def("security.arm", "Arm security", "Arm an alarm panel.", "R3", "idempotent"),
  def("security.disarm", "Disarm security", "Disarm an alarm panel.", "R4", "at_most_once"),
  def("media.play", "Play media", "Start playback on a media device.", "R1", "idempotent"),
  def("media.pause", "Pause media", "Pause playback.", "R1", "idempotent"),
  def("media.source", "Set media source", "Change the active media source.", "R1", "idempotent"),
  def("vacuum.start", "Start vacuum", "Start a robot vacuum job.", "R1", "compensatable"),
  def("vacuum.dock", "Dock vacuum", "Return a robot vacuum to its dock.", "R1", "idempotent"),
  def(
    "irrigation.runZone",
    "Run irrigation zone",
    "Run a garden irrigation zone.",
    "R3",
    "at_most_once",
  ),
  def("energy.setLimit", "Set energy limit", "Cap a high load or EV charger.", "R2", "idempotent"),
  def("energy.charge", "Charge", "Start or stop charging a high load.", "R2", "compensatable"),
  def(
    "camera.snapshot",
    "Camera snapshot",
    "Capture a still image from a camera.",
    "R2",
    "idempotent",
    true,
  ),
  def(
    "camera.analyze",
    "Analyze camera",
    "Analyze a camera frame with a vision model.",
    "R2",
    "idempotent",
    true,
  ),
];

const byId = new Map(definitions.map((item) => [item.id, item]));

export function listCapabilities(): CapabilityDefinition[] {
  return [...definitions];
}

export function getCapability(id: CapabilityId): CapabilityDefinition {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return found;
}

function def(
  id: CapabilityId,
  title: string,
  description: string,
  baseRisk: CapabilityDefinition["baseRisk"],
  idempotency: CapabilityDefinition["idempotency"],
  privacySensitive = false,
): CapabilityDefinition {
  return CapabilityDefinitionSchema.parse({
    id,
    title,
    description,
    baseRisk,
    idempotency,
    privacySensitive,
  });
}
