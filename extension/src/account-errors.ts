const messages = {
  not_configured: 'This extension build is not connected to Mighty. Download a new copy from the app.',
  verification_unavailable: 'Mighty could not reach account verification. Check your connection and reconnect.',
  verification_rejected: 'Your app session could not be verified. Sign in to Mighty again, then reconnect.',
  verification_failed: 'Account verification is temporarily unavailable. Try connecting again.',
  verification_unreadable: 'Account verification returned an unreadable response. Try connecting again.',
  verification_invalid: 'Account verification returned an invalid account. Reconnect from Mighty.',
  session_invalid: 'The app session has an unsupported format. Sign in to Mighty again, then reconnect.',
  session_mismatch: 'The app session does not match the verified account. Reconnect from Mighty.',
  session_project_mismatch: 'The app and extension use different account services. Download the current extension from Mighty.',
  session_expired: 'Your app session expired. Sign in to Mighty again, then reconnect.',
  session_lifetime: 'The app session lasts longer than the extension allows. Update Mighty and reconnect.',
  goals_unavailable: 'Account goals could not be refreshed. Check your connection and reconnect from Mighty.',
  goals_session_rejected: 'Account goals could not be loaded because the session expired. Sign in to Mighty again, then reconnect.',
  goals_forbidden: 'Account goals could not be loaded because access was refused. Update Mighty and reconnect.',
  goals_failed: 'Account goals could not be loaded. Try connecting again from Mighty.',
  goals_unreadable: 'Account goals returned an unreadable response. Reconnect from Mighty.',
  goals_invalid: 'Account goals are incompatible or incomplete. Update Mighty and reconnect; no previous goals are being used.',
  goals_incomplete: 'Account goals could not be loaded completely. Reconnect from Mighty; no previous goals are being used.',
  goals_cache_invalid: 'Saved account goals could not be verified. Reconnect from Mighty.',
  connection_superseded: 'A newer account connection replaced this request. Return to Mighty and try again.',
  connection_failed: 'The account connection could not be completed. Reconnect from Mighty.',
} as const;
export type AccountErrorCode = keyof typeof messages;
export class AccountConnectionError extends Error {
  constructor(readonly code: AccountErrorCode) {super(messages[code]); this.name = 'AccountConnectionError';}
}
/** Only locally defined diagnostics cross the bridge, never arbitrary exceptions or provider bodies. */
export function accountFailure(error: unknown): {code: AccountErrorCode; message: string} {
  const code = error instanceof AccountConnectionError ? error.code : 'connection_failed';
  return {code, message: messages[code]};
}
