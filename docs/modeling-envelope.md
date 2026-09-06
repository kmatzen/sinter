# Numerical modeling envelope

Sinter guarantees geometry inside a cube of **±8,192 mm** on each world axis, with a minimum supported physical feature of **0.1 mm** and a maximum composed non-uniform scale ratio of **1,000:1**.

The spatial limit is chosen from float32 behavior, not from an arbitrary UI range. At 8,192 mm the adjacent float32 spacing is 0.0009765625 mm, leaving more than 100 representable steps across the minimum feature. Viewport surface classification, depth picking, clipping, and measurement coordinates therefore use a 0.002 mm boundary tolerance at the edge of the supported region. CPU export evaluates the same normalized operation tree at higher precision.

Every document entry path enforces this contract:

- property edits clamp individual spatial fields and normalize rotations to one equivalent turn;
- current project documents reject values that would require clamping, while legacy documents migrate safely;
- imported mesh vertices outside the cube are rejected;
- worker evaluation checks composed bounds, post-scale feature size, and cumulative anisotropy before viewport generation or export;
- values outside the envelope produce an actionable modeling-envelope error instead of rendering plausible but unreliable geometry.

Angles are canonicalized to `[-180°, 180°)`. Equivalent rotations such as 0°, 360°, and 1,000,080° therefore generate the same CPU field and GPU parameters.

The limit applies to resolved geometry, not merely each input. For example, two individually legal nested translations whose combined result crosses 8,192 mm are rejected. A model can be rescaled or moved nearer the origin to bring it back into the supported envelope.
