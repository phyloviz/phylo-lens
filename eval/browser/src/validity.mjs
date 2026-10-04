export function observationValidity({
  unexpectedNetworkCount,
  unexpectedViewportRequests,
  frameSampleCount,
  minimumFrameSampleCount,
  replayContractFailure,
  fixedReplayViewport = false,
}) {
  if (replayContractFailure)
    return { status: "failure", failure_kind: "replay_contract_failure" };
  if (unexpectedNetworkCount)
    return { status: "invalid", failure_kind: "unexpected_network_request" };
  if (unexpectedViewportRequests > 0 && !fixedReplayViewport)
    return { status: "invalid", failure_kind: "unexpected_viewport_request" };
  if (frameSampleCount < minimumFrameSampleCount)
    return { status: "invalid", failure_kind: "insufficient_frame_samples" };
  return { status: "success", failure_kind: "none" };
}
