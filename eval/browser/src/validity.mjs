export function observationValidity({ unexpectedNetworkCount, unexpectedViewportRequests, frameSampleCount, minimumFrameSampleCount, replayContractFailure }) {
  if (replayContractFailure) return { status: "failure", failure_kind: "replay_contract_failure" };
  if (unexpectedNetworkCount) return { status: "invalid", failure_kind: "unexpected_network_request" };
  if (unexpectedViewportRequests > 0) return { status: "invalid", failure_kind: "unexpected_viewport_request" };
  if (frameSampleCount < minimumFrameSampleCount) return { status: "invalid", failure_kind: "insufficient_frame_samples" };
  return { status: "success", failure_kind: "none" };
}
