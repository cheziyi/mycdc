const SALT = 'mycdc-device-v1';
const HEXADECIMAL_DIGITS = '0123456789abcdef';

export interface DeviceIdentity {
  /** Sent as the `User-Agent` header and again as the `device_type` field. */
  userAgent: string;
  /** 16 lowercase hexadecimal characters, sent as the `player_id` field. */
  playerId: string;
}

const DEVICES: ReadonlyArray<readonly [model: string, buildId: string, androidVersion: string]> = [
  ['CLT-L29', 'HUAWEICLT-L29', '10'],
  ['SM-G973F', 'QP1A.190711.020', '10'],
  ['SM-A515F', 'RP1A.200720.012', '11'],
  ['M2101K6G', 'RKQ1.200826.002', '11'],
  ['Redmi Note 9 Pro', 'RQ3A.211001.001', '11'],
  ['SM-G991B', 'SP1A.210812.016', '12'],
  ['Pixel 6', 'SQ3A.220705.003', '12'],
  ['V2027', 'SP1A.210812.003', '12'],
  ['SM-S908B', 'TP1A.220624.014', '13'],
  ['Pixel 7', 'TQ2A.230505.002', '13'],
  ['2201116SG', 'TKQ1.220829.002', '13'],
  ['SM-S918B', 'UP1A.231005.007', '14'],
];

/**
 * The same learner ID always gives the same identity. The `#0` suffix and the
 * byte offsets are fixed: changing either gives every learner a different one.
 */
export async function deriveDeviceIdentity(learnerId: string): Promise<DeviceIdentity> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${SALT}:${learnerId}#0`)),
  );

  const [model, buildId, androidVersion] = DEVICES[((digest[0] << 8) | digest[1]) % DEVICES.length];
  let playerId = '';
  for (const byte of digest.subarray(2, 18)) playerId += HEXADECIMAL_DIGITS[byte % 16];

  return {
    userAgent: `Dalvik/2.1.0 (Linux; U; Android ${androidVersion}; ${model} Build/${buildId})`,
    playerId,
  };
}
