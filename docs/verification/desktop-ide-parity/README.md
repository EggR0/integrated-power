# Desktop and IDE prewarm parity evidence

These PNGs were captured by the existing headless Chromium regression fixtures
with synthetic quota state and a fake broker. They document rendered source
behavior after the changes; they are not captures of an installed VSIX or a
launched native desktop application.

- `ide-capacity.png`: IDE quota panel with synthetic partial 5-hour and weekly
  usage, per-model prewarm controls, and five/seven-part gauge markers.
- `desktop-tokens.png`: desktop token page with synthetic Ready state, three
  per-model actions, mode controls, 5/7 gauge markers and the fake legacy
  broker's truthful acknowledgement toast.

The Chromium suites separately verify eligible model dispatch, disabled
ineligible controls, marker geometry across partial/Ready/unavailable states,
and desktop layout at 199, 160 and 120 pixels. Neither fixture contacts a live
provider or writes to the live broker.
