import * as THREE from 'three/webgpu'
import { abs, dot, float, mix, pass, screenUV, smoothstep, uniform, vec3 } from 'three/tsl'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'

/**
 * The miniature look for the model of Rome (DESIGN.md §7.7): a tilt-shift — the top
 * and bottom of the frame out of focus, as a photograph of a model is at close
 * range — and a touch more contrast and colour. It is a pass over the whole frame,
 * so it only runs while the model stands and the view is tilted (`amount` > 0);
 * otherwise the map renders as it always has.
 */
export class Miniature {
  /** 0 off … 1 full. Set per frame by RomeMap from the model's rise and the tilt. */
  readonly amount = uniform(0)
  private pipeline: THREE.RenderPipeline

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.pipeline = new THREE.RenderPipeline(renderer)
    const colour = pass(scene, camera).getTextureNode()
    const blurred = gaussianBlur(colour, float(0.9), 4, { resolutionScale: 0.5 })
    // In focus across a band a little below the middle, where the eye rests on a
    // tilted view; soft towards the top (far) and bottom (near) of the frame.
    const off = smoothstep(0.22, 0.56, abs(screenUV.y.sub(0.54)))
      .mul(this.amount)
      .mul(0.7)
    const c = mix(colour.rgb, blurred.rgb, off)
    const luma = dot(c, vec3(0.2126, 0.7152, 0.0722))
    const graded = mix(vec3(luma), c, float(1).add(this.amount.mul(0.1)))
      .sub(0.5)
      .mul(float(1).add(this.amount.mul(0.06)))
      .add(0.5)
    this.pipeline.outputNode = graded
  }

  render() {
    this.pipeline.render()
  }
}
