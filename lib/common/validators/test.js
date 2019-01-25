export default function test(resourceType, resource) {
  if (resourceType === "devices") {
    if (resource["Tags.test"] && resource["Tags.test"].value[0]) return 1;
  } else if (resourceType === "presets") {
    if (resource["_id"].startsWith("test-"))
      // TODO check "test" tag too
      return 1;
  } else if (resourceType === "provisions") {
    if (resource["_id"].startsWith("test-")) return 1;
  }
  return -1;
}
