# EREN XMD — fixes included (2026-10-14)

This is the complete project based on the uploaded `EREN NEW FILE.zip`, with the web pairing portal and existing plugins retained.

## Changes
- Added `.antimedia on/off`: when enabled in a group where the bot is an admin, direct image/video posts are deleted. View-once media is excluded.
- Added `.pdm on/off`: promote/demote event notices are off by default and only sent when enabled per group.
- Fixed the `rahulbomb` command argument handling (`a` was not passed into the handler). To reduce accidental flooding, it is intentionally capped at 5 sequential sends per command.
- Improved AntiBot message detection by loading cached group metadata after AntiBot is enabled, so participant names/verified names can be checked. WhatsApp does not provide a universal reliable bot-account flag; configure known bot numbers using `.antibot add +countrycode-number` for reliable ID-based detection.
- Fixed the undefined group metadata variable in welcome/goodbye events and normalized bot-number keys so the command and event handlers use the same database key.
- Kept default welcome/goodbye templates and the rotating welcome video with the welcome text as the video caption.
- Changed `.setmention` to append multiple quoted text/media replies and cycle through them in a shuffled order without repeating an item within the same cycle. Supports text, sticker, image, video, audio and document replies. Only the configured owner numbers can manage these replies. `.delmention` removes all saved replies.
- Added `.antimedia` and `.pdm` to the group menu catalog.

## Owner numbers allowed for setmention
- 916297085571
- 917029177912
- 917431831126
- 37444520793

## Checks run
- `npm run check` — passed; 86 JavaScript files passed Node.js syntax checks.
- Archive integrity check — run after packaging.

## Important verification note
The project was not connected to a live WhatsApp account during this repair. Syntax checks do not prove live WhatsApp delivery, permissions, view-once decoding behavior, or group-status API compatibility. Test first in a private test group with the bot promoted to admin. The `.rahulbomb` command is limited to 5 messages to avoid flooding a group.
