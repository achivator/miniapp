# Achivator landing artwork

Final assets are generated with the built-in image_gen tool from two references:
1. Canonical Blender geometry, with the presentation pose and camera prepared in
   `design/site-references/hero-wave.blend` and `achievement-present.blend`.
2. The user's Poop Master art-direction sheet supplied on 2026-09-30.

The Blender renders are geometry references, never the final website artwork.
The generated hero establishes the material style for the three achievement
illustrations. All five final PNGs preserve transparency.

- `achivator-hero-generated.png`: base character, no accessories.
- `poop-master.png`: crown and tray, epic visual treatment.
- `night-owl.png`: coffee, sleepy blue eyes, rare visual treatment.
- `sad-clown.png`: party hat and pixel tear.
- `locked.png`: pixel question-mark eyes and a cream gift box with grey ribbon and brass padlock.
- `poop-master-sticker.png`: separate inked 2D sticker illustration.

The exact prompts are in `docs/brand/prompts.json`. These are marketing assets;
existing earned achievement art, backend rarity and trigger rules are unchanged.
Next Image provides responsive delivery. `.brand-landing` scopes the public
visual identity; the Telegram dashboard retains its theme semantics.
