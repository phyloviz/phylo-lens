export function matchesCaptureInput(event, specification, root) {
  if (
    event.type !== specification.nativeEventType ||
    !event.isTrusted ||
    (specification.clickCount != null &&
      event.detail !== specification.clickCount) ||
    !root.contains(event.target)
  ) {
    return false;
  }
  const tolerance = specification.coordinateTolerancePx ?? 2;
  return (
    Math.abs(event.clientX - specification.clientX) <= tolerance &&
    Math.abs(event.clientY - specification.clientY) <= tolerance
  );
}

export function armCaptureInput(document, root, specification, onCapture) {
  let armed = true;
  const listener = (event) => {
    if (!armed || !matchesCaptureInput(event, specification, root)) return;
    const mouse = event;
    onCapture({
      eventType: specification.eventType,
      nativeEventType: mouse.type,
      clickCount: mouse.detail,
      capturePhase: true,
      timestamp: performance.now(),
      clientX: mouse.clientX,
      clientY: mouse.clientY,
      isTrusted: mouse.isTrusted,
      targetClusterId: specification.targetClusterId,
      stage: "graph-root",
    });
    armed = false;
    document.removeEventListener(specification.nativeEventType, listener, true);
  };
  document.addEventListener(specification.nativeEventType, listener, true);
  return () => {
    armed = false;
    document.removeEventListener(specification.nativeEventType, listener, true);
  };
}
