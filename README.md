# Magic Conch

A Tampermonkey userscript for course learning assistance. The panel detects the platform automatically.

## Installation and Usage

Use a current version of Chrome. Create a new script in Tampermonkey, paste the entire contents of `pc.user.js` (or `pc.js`), and save. Sign in to the platform, refresh the page, and click the Start button on the floating panel. After updating the script, save and refresh all open course windows.

Expand the task selector in the panel on any page. All maps are selected by default; pause to change your selection. Use **Refresh tasks** to update the list. Concurrent windows can work across selected maps.

Features include continuous course playback, automatic muting, and 1–6 concurrent course windows. If a section remains unmarked after playback and a synchronization wait, the script replays the last 30 seconds. It pauses if the section is still incomplete after three replays. The platform's learning records determine completion.

Jiangnan: sign in manually, then click Start. The script sets the timer one second before a whole minute and waits for the platform's native report. Tasks run sequentially with supported exam answering/submission and automatic 5-star evaluations. Missing answers or unsupported questions pause the script. Platform completion is verified before continuing.

Changing Yizhi accounts clears previous learning caches and stops stale windows. Panel preferences remain unchanged.
