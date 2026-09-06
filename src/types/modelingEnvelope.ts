/**
 * Absolute spatial envelope shared by editable geometry and imported data.
 * 8192 is exactly representable in float32; its ULP is 0.0009765625 mm, so the
 * minimum 0.1 mm feature retains more than 100 representable steps even at the
 * furthest supported coordinate before matrix arithmetic.
 */
export const MODEL_SPATIAL_LIMIT_MM = 8192;
