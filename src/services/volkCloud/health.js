export const CLOUD_AVAILABILITY = Object.freeze({
  CHECKING: 'checking',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
});

export async function checkVolkCloudHealth(client) {
  try {
    const payload = await client.health();
    if (payload?.status !== 'ok') {
      return { status: CLOUD_AVAILABILITY.UNAVAILABLE, reason: 'invalid-health-response' };
    }
    return {
      status: CLOUD_AVAILABILITY.AVAILABLE,
      service: payload.service ?? null,
      apiVersion: payload.apiVersion ?? null,
    };
  } catch {
    return { status: CLOUD_AVAILABILITY.UNAVAILABLE, reason: 'backend-unreachable' };
  }
}
