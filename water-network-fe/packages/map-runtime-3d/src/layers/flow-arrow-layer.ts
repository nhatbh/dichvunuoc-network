/**
 * 3D flow arrows animated on the GPU.
 *
 * Every arrow is one instance of a small mesh wrapped on the tube surface. Its instance data (anchor,
 * frame, phase along its pipe segment) is built once per network/view change; each animation frame
 * only changes the `flowTime` uniform, and the vertex shader slides the arrow along its segment and
 * fades it in and out at the segment ends. No per-frame CPU work or buffer uploads.
 */
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import type { SimpleMeshLayerProps } from '@deck.gl/mesh-layers';
import type { DefaultProps } from '@deck.gl/core';
import type { ArrowInstance } from './flow.js';

export type { ArrowInstance };

const uniforms = {
  name: 'flowArrow',
  vs: `\
layout(std140) uniform flowArrowUniforms {
  float time;
} flowArrow;
in vec4 instanceFlow;
float flowArrowVis;
vec3 flowArrowAlong;
`,
  uniformTypes: { time: 'f32' },
} as const;

type Props = SimpleMeshLayerProps<ArrowInstance> & { flowTime: number; getFlow: (d: ArrowInstance) => [number, number, number, number] };

const defaultProps: DefaultProps<Props> = {
  flowTime: 0,
  getFlow: { type: 'accessor', value: [0, 1, 0, 1] },
} as never;

export class FlowArrowLayer extends SimpleMeshLayer<ArrowInstance, { flowTime: number; getFlow: Props['getFlow'] }> {
  static override layerName = 'FlowArrowLayer';
  static override defaultProps = defaultProps as never;

  override getShaders() {
    const s = super.getShaders();
    return {
      ...s,
      modules: [...s.modules, uniforms],
      inject: {
        'vs:#main-start': `
  {
    // where this arrow is along its segment now, and how visible (it grows in / shrinks out at the ends)
    float s = mod(instanceFlow.x + flowArrow.time * instanceFlow.z, instanceFlow.y);
    float edge = min(s, instanceFlow.w - s);
    flowArrowVis = s > instanceFlow.w ? 0.0 : clamp(edge / max(instanceFlow.w * 0.12, 0.25), 0.0, 1.0);
    flowArrowAlong = normalize(instanceModelMatrixCol0) * s;
  }
`,
        'vs:DECKGL_FILTER_SIZE': `
  size = size * flowArrowVis + (simpleMesh.composeModelMatrix ? flowArrowAlong : project_size(flowArrowAlong));
`,
        'vs:DECKGL_FILTER_COLOR': `
  color.a *= flowArrowVis;
`,
      },
    };
  }

  override initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceFlow: { size: 4, accessor: 'getFlow' },
    });
  }

  override draw(opts: Parameters<SimpleMeshLayer['draw']>[0]) {
    const model = this.state.model as { shaderInputs: { setProps: (p: unknown) => void } } | undefined;
    model?.shaderInputs.setProps({ flowArrow: { time: this.props.flowTime } });
    super.draw(opts);
  }
}
