import { NodeCircleProgram } from "sigma/rendering";
import type { NodeHoverDrawingFunction } from "sigma/rendering";
import type { NodeDisplayData } from "sigma/types";

const TRIANGLE_VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;
attribute float a_rotation;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 1.35;
  float angle = a_angle + a_rotation;
  vec2 position = a_position + size * vec2(cos(angle), sin(angle));

  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

const TRIANGLE_FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
void main(void) { gl_FragColor = v_color; }
`;

export class TriangleNodeProgram extends NodeCircleProgram {
  override drawHover = drawTriangleNodeHover;

  override getDefinition() {
    const baseDefinition = super.getDefinition();
    return {
      ...baseDefinition,
      VERTEX_SHADER_SOURCE: TRIANGLE_VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: TRIANGLE_FRAGMENT_SHADER,
      ATTRIBUTES: [
        ...baseDefinition.ATTRIBUTES,
        {
          name: "a_rotation",
          size: 1,
          type: WebGLRenderingContext.FLOAT,
        },
      ],
    };
  }

  override processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData): void {
    super.processVisibleItem(nodeIndex, startIndex, data);
    this.array[startIndex + 5] = rotationOf(data);
  }
}

export const drawTriangleNodeHover: NodeHoverDrawingFunction = (context, data) => {
  // Sigma's graph-to-screen transform flips the vertical axis. Hover drawing
  // receives screen-space coordinates, so invert the graph-space rotation to
  // preserve the direction of the WebGL triangle.
  const rotation = -rotationOf(data);

  context.save();
  context.shadowBlur = 8;
  context.shadowColor = "#000";
  context.fillStyle = "#fff";
  trianglePath(context, data.x, data.y, data.size + 3, rotation);
  context.fill();

  context.shadowBlur = 0;
  context.fillStyle = data.color;
  trianglePath(context, data.x, data.y, data.size * 1.35, rotation);
  context.fill();
  context.restore();
};

function trianglePath(context: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number): void {
  context.beginPath();
  for (let index = 0; index < 3; index += 1) {
    const angle = rotation + (index * Math.PI * 2) / 3;
    const point = [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius] as const;
    if (index === 0) context.moveTo(...point);
    else context.lineTo(...point);
  }
  context.closePath();
}

function rotationOf(data: object): number {
  const rotation = (data as Record<string, unknown>).triangleRotation;
  return typeof rotation === "number" && Number.isFinite(rotation) ? rotation : 0;
}
