import { NodeCircleProgram } from "sigma/rendering";

const TRIANGLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
}
`;

export class TriangleNodeProgram extends NodeCircleProgram {
  override getDefinition() {
    const baseDefinition = super.getDefinition();
    return {
      ...baseDefinition,
      FRAGMENT_SHADER_SOURCE: TRIANGLE_FRAGMENT_SHADER,
    };
  }
}
