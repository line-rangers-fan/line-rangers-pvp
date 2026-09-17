// One small, shared place for browser and upstream time limits.  Keeping these
// values explicit prevents a stalled optional service from leaving UI pending
// forever, while large upload parts still get a realistic network allowance.
export const communityTimeouts={
 // The first Worker request can include a cold start. Keep a small margin
 // above the observed cold-start latency so a valid board response is not
 // mislabeled as an outage; mutations retain their shorter limits.
 readMs:15_000,
 writeMs:15_000,
 translationMs:7_000,
 imageUploadMs:45_000,
 videoSessionMs:20_000,
 videoPartMs:300_000,
 videoCompleteMs:60_000,
};
