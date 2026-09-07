/* Trumpet Flight - canonical rider hitbox + on-screen display scale.
 * Single source of truth for what actually kills the player: two rotated
 * capsules ("pill" shapes), not the sprite's square bounding box. Embedded
 * into index.html for atomic offline updates; also loaded as-is by
 * tools/character-lab so the lab's hitbox overlay can never drift from
 * what the shipped game actually collides against.
 *
 * displayScale: the 42px sprite is drawn at 48px on screen; every collision
 * dimension below is authored in 42px sprite-space and scaled up by this.
 * localCentre: where riderCollision's own coordinate origin sits relative
 * to the sprite's centre, in sprite-space.
 * capsules: each is a line segment (length, at `angle` degrees, centred at
 * x/y relative to localCentre) swept by a circle of `thickness` diameter.
 */
window.TRUMPET_HITBOX = {
  displayScale: 48 / 42,
  localCentre: { x: 0, y: -1 },
  capsules: [
    { x: -2, y: 1, length: 21, angle: 90, thickness: 18 },
    { x: 3, y: 12, length: 27, angle: -25, thickness: 10 }
  ]
};
