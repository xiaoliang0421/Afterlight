# Playback acceptance

## Changes verified in the local browser

- Captions used to be very small at phone widths and overlap custom controls. The video and controls now occupy separate rows; native captions have a readable minimum font size. Video overlays remain bounded to the image, including when the player occupies fullscreen.
- A connection that stopped delivering bytes could leave `Buffering…` indefinitely without a media error. After 15 seconds of continued loading, the player now offers an explicit retry at the saved position while allowing the original load to continue. A successful load clears the prompt.
- A rejected fullscreen request used to set the media error and obscure an otherwise playable video. It now produces an inline notice while ordinary playback remains available.

These changes were exercised through the actual `Player` component with synthetic local footage:

| Scenario | Observed result |
| --- | --- |
| 320- and 390-pixel viewport | English cues remained readable and separate from the controls; playback, captions and fullscreen buttons remained visible. |
| Incomplete HTTP response with an open socket | The original player stayed buffering; the revised player exposed a retry at chapter position 0:15 in scene 2. |
| Connection restored, then manual retry | Scene 2 and chapter position 0:15 were retained; loading/retry feedback cleared. |
| HTTP 503, then 32 kbit/s recovery | The error offered retry; resumed playback progressed from scene 2 through scene 3 to chapter completion at 0:30. |
| Fullscreen rejected by the browser | Inline notice appeared, and Play still started the video. Successful native fullscreen remains a separate check. |

## Reproduce without providers or accounts

Run `npm run test:playback:manual` and open the printed loopback URL. The harness serves the production Player with three visibly labeled sample segments. Its connection selector changes only synthetic media requests: Normal, Slow (1 KiB per 250 ms), Stalled response, or Unavailable (HTTP 503). It does not change the computer's network, sign in, contact model providers, or publish content.

Apply a condition, confirm the displayed applied mode, then use **Reload player at saved position** to force a new media request. For a recovery check, restore the connection and use the Player's **Retry playback**, keeping its component and scene state intact. Every reload has a separate media URL to prevent a previously decoded clip from hiding the fault. If edits are not reflected by hot reload, restart the lab server and reload the page before recording evidence. Stop the server when finished.

The lab script and HTML/TSX fixture are outside the production build entry. They are manual acceptance tools, not additions to the automated test count.

## Remaining acceptance

Phone viewport testing in desktop Chromium does not establish iPhone Safari or Android Chrome device behavior. Real-device background/foreground transitions, rotation, successful native fullscreen, operating-system offline/online events, and throttled delivery of real published media remain to be verified. The synthetic three-segment chapter tests the player and author/timeline mapping, not model-generated story continuity.
